import crypto from 'node:crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import { config, isMockMode } from '../config.js';
import { log, logError, recordAttempt, getAttempts, formatAttempt } from '../diagnostics.js';
import { loadSession, startSession, loadSessionByState, consumeSession, sessionCount } from '../sessions.js';
import { getProvider, providerModeBanner } from '../verification/index.js';
import { MOCK_SCENARIOS, DEFAULT_SCENARIO } from '../verification/mockProvider.js';
import { evaluateVeteranEligibility } from '../eligibility.js';
import { assignVeteranRole } from '../discord/roles.js';

const COOKIE = 'dz_verify_session';
const secureCookies = config.publicBaseUrl.startsWith('https://');

export function createWebServer(discordClient) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());

  app.get('/healthz', (req, res) => {
    res.json({ ok: true, mode: config.idme.mode, activeSessions: sessionCount() });
  });

  // NOTE: this specific route MUST be registered before the wildcard
  // '/verify/:token' below — Express matches routes in registration order,
  // and ':token' would otherwise swallow every request to '/verify/callback'
  // by treating the literal word "callback" as a session token.
  app.get('/verify/callback', async (req, res) => {
    const { code, state, error: providerError } = req.query;

    if (providerError) {
      log('callback_provider_error', { providerError: String(providerError) });
      return res.status(400).send(page('Verification cancelled', statusCard('warning',
        'Verification cancelled',
        `The provider returned: ${esc(String(providerError))}`,
        'Run /verify in Discord again to start over.',
      )));
    }

    const loaded = loadSessionByState(state);
    if (!loaded.ok) {
      log('callback_rejected', { reason: loaded.reason });
      return res.status(400).send(page('Verification rejected', errorBlock(loaded.reason)));
    }
    const { session } = loaded;

    // Same-browser check. Can be turned off for mobile in-app browsers that
    // drop the cookie mid-flow; `state` + single-use session still stand.
    if (config.requireSameBrowser && req.cookies?.[COOKIE] !== session.token) {
      log('callback_rejected', { reason: 'session_cookie_mismatch', discordUserId: session.discordUserId });
      return res.status(400).send(page('Verification rejected', errorBlock(
        'This callback did not come from the browser that started verification.',
      )));
    }

    if (typeof code !== 'string' || !code) {
      return res.status(400).send(page('Verification rejected', errorBlock('no authorization code returned')));
    }

    // Burn the session before doing any work — a replayed callback finds nothing.
    const consumed = consumeSession(session.token);
    if (!consumed.ok) {
      log('callback_rejected', { reason: consumed.reason });
      return res.status(400).send(page('Verification rejected', errorBlock(consumed.reason)));
    }
    res.clearCookie(COOKIE, { path: '/' });

    const provider = getProvider();
    const attempt = {
      discordUserId: session.discordUserId,
      providerLabel: provider.label,
      group: null,
      subgroups: [],
      verified: null,
      eligibility: 'Not evaluated',
      roleAssignment: 'Not attempted',
    };

    let result = null;
    try {
      result = await provider.fetchVerification({ code, session });
      attempt.group = result.group;
      attempt.subgroups = result.subgroups;
      attempt.verified = result.verified;
    } catch (err) {
      // Fail closed. Malformed, failed or uncertain -> no role, full stop.
      logError('verification_failed', err, { discordUserId: session.discordUserId });
      attempt.eligibility = `Not eligible — provider result unusable (${err.message})`;
      attempt.roleAssignment = 'NOT ATTEMPTED';
      recordAttempt(attempt);
      return res.status(400).send(resultPage(attempt, 'error'));
    }

    const decision = evaluateVeteranEligibility(result);
    attempt.eligibility = decision.reason;

    if (!decision.eligible) {
      attempt.roleAssignment = 'NOT ATTEMPTED (not eligible)';
      recordAttempt(attempt);
      return res.send(resultPage(attempt, 'neutral'));
    }

    const roleResult = await assignVeteranRole(discordClient, {
      discordUserId: session.discordUserId,
      reason: `Verified via ${provider.label}`,
    });
    attempt.roleAssignment = roleResult.ok
      ? `SUCCESS — ${roleResult.code}: ${roleResult.message}`
      : `FAILED — ${roleResult.code}: ${roleResult.message}`;

    recordAttempt(attempt);
    res.status(roleResult.ok ? 200 : 500).send(resultPage(attempt, roleResult.ok ? 'success' : 'error'));
  });

  // ── Step 1: the user opens their personal link ────────────────────────────
  app.get('/verify/:token', (req, res) => {
    const loaded = loadSession(req.params.token);
    if (!loaded.ok) {
      log('link_rejected', { reason: loaded.reason, sessionRef: req.params.token.slice(0, 8) });
      return res.status(400).send(page('Verification link not usable', errorBlock(loaded.reason)));
    }

    const state = crypto.randomBytes(32).toString('base64url');
    const provider = getProvider();
    const { url, codeVerifier, nonce } = provider.createAuthorizationRequest({ state });

    const started = startSession(req.params.token, { state, codeVerifier, nonce });
    if (!started.ok) {
      log('link_rejected', { reason: started.reason, sessionRef: req.params.token.slice(0, 8) });
      return res.status(400).send(page('Verification link not usable', errorBlock(started.reason)));
    }

    // Ties the rest of the flow to this browser. A callback arriving in a
    // different browser, with a stolen link or state, has no matching cookie.
    res.cookie(COOKIE, req.params.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: secureCookies,
      maxAge: config.sessionTtlSeconds * 1000,
      path: '/',
    });

    log('authorization_redirect', {
      discordUserId: started.session.discordUserId,
      sessionRef: req.params.token.slice(0, 8),
      mock: isMockMode(),
    });
    res.redirect(url);
  });

  // ── Mock-only: stands in for the ID.me consent screen ─────────────────────
  if (isMockMode()) {
    app.get('/mock/idme/authorize', (req, res) => {
      const loaded = loadSessionByState(req.query.state);
      if (!loaded.ok) {
        log('mock_consent_rejected', { stage: 'get', reason: loaded.reason });
        return res.status(400).send(page('Mock authorization failed', errorBlock(loaded.reason)));
      }

      const scenario = MOCK_SCENARIOS[loaded.session.scenario] ?? MOCK_SCENARIOS[DEFAULT_SCENARIO];
      res.send(page('Relay — Mock provider', `
        ${flowCard('Discord', 'Relay', 'ID.me (simulated)')}
        <div class="notice">
          <strong>This is a simulated provider.</strong> No ID.me system is contacted. The result below
          was fixed server-side when <code>/verify</code> ran in Discord — nothing on this page can change it.
        </div>
        <table class="detail-table">
          <tr><th>Status</th><td>${esc(scenario.label)}</td></tr>
          <tr><th>Group</th><td>${esc(scenario.payload.group ?? '(malformed)')}</td></tr>
          <tr><th>Subgroups</th><td>${esc((scenario.payload.subgroups ?? ['(malformed)']).join(', '))}</td></tr>
          <tr><th>Verified</th><td>${esc(String(scenario.payload.verified))}</td></tr>
          <tr><th>Expectation</th><td>${esc(scenario.expectation)}</td></tr>
        </table>
        <form method="post" action="/mock/idme/authorize">
          <input type="hidden" name="state" value="${esc(req.query.state)}">
          <button type="submit" class="btn-primary">Continue</button>
        </form>
      `));
    });

    app.post('/mock/idme/authorize', (req, res) => {
      const state = req.body?.state;
      const loaded = loadSessionByState(state);
      if (!loaded.ok) {
        log('mock_consent_rejected', { stage: 'post', reason: loaded.reason });
        return res.status(400).send(page('Mock authorization failed', errorBlock(loaded.reason)));
      }

      // Scenario comes from the SESSION, never from the form body.
      const code = getProvider().issueAuthorizationCode({
        state,
        scenario: loaded.session.scenario ?? DEFAULT_SCENARIO,
      });
      const url = new URL(`${config.publicBaseUrl}/verify/callback`);
      url.searchParams.set('code', code);
      url.searchParams.set('state', state);
      res.redirect(url.toString());
    });
  }

  // ── Operator view ─────────────────────────────────────────────────────────
  app.get('/diagnostics', (req, res) => {
    if (!config.diagnosticsToken || req.query.token !== config.diagnosticsToken) {
      return res.status(404).send(page('Not found', '<p>Not found.</p>'));
    }
    const rows = getAttempts();
    const body = rows.length
      ? rows.map((a) => `<div class="detail-panel"><div class="detail-panel-time">${esc(a.at)}</div><pre>${esc(formatAttempt(a))}</pre></div>`).join('')
      : '<p class="muted">No verification attempts recorded yet.</p>';
    res.send(page('Relay — Diagnostics', `<p class="mode-line">${esc(providerModeBanner())}</p>${body}`));
  });

  app.use((req, res) => res.status(404).send(page('Not found', '<p>Not found.</p>')));

  return app;
}

// ── brand ───────────────────────────────────────────────────────────────────

const MARK_B64 = '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';
const FAVICON_B64 = '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';

const BRAND = {
  slate: '#0F172A',
  blue: '#2563EB',
  teal: '#14B8A6',
  violet: '#8B5CF6',
  white: '#F8FAFC',
  gray: '#94A3B8',
};

// Real Relay brand assets, base64-embedded as WebP so every page stays a
// single self-contained file with no separate static-asset route needed.
// MARK_SRC = the icon (white background, as designed) for the topbar and the
// flow-diagram node. FAVICON_SRC = the app-icon crop, transparent corners.
const MARK_SRC = `data:image/webp;base64,${MARK_B64}`;
const FAVICON_SRC = `data:image/webp;base64,${FAVICON_B64}`;
const LOGO_IMG = `<img src="${MARK_SRC}" alt="Relay" class="brand-mark">`;

// ── tiny view helpers ───────────────────────────────────────────────────────

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const STATUS_STYLES = {
  success: { bg: '#ECFDF5', border: '#99F6E4', text: '#0F766E', icon: '✓' },
  neutral: { bg: '#F1F5F9', border: '#CBD5E1', text: '#334155', icon: 'i' },
  warning: { bg: '#FFFBEB', border: '#FDE68A', text: '#92400E', icon: '!' },
  error:   { bg: '#FEF2F2', border: '#FECACA', text: '#B91C1C', icon: '!' },
};

function statusCard(variant, heading, message, footnote = '') {
  const s = STATUS_STYLES[variant] ?? STATUS_STYLES.neutral;
  return `
    <div class="status-card" style="background:${s.bg};border-color:${s.border};">
      <div class="status-icon" style="background:${s.text};">${s.icon}</div>
      <div>
        <div class="status-heading" style="color:${s.text};">${esc(heading)}</div>
        <div class="status-message">${message}</div>
        ${footnote ? `<div class="status-footnote">${esc(footnote)}</div>` : ''}
      </div>
    </div>`;
}

const errorBlock = (reason) => statusCard(
  'warning',
  'Request rejected',
  `<code>${esc(reason)}</code>`,
  'No role was assigned. Run /verify in Discord again to start over.',
);

function flowCard(from, mid, to) {
  return `
    <div class="flow-card">
      <div class="flow-node"><div class="flow-label">${esc(from)}</div></div>
      <div class="flow-arrow">→</div>
      <div class="flow-node flow-node-brand">${LOGO_IMG}<div class="flow-label">${esc(mid)}</div></div>
      <div class="flow-arrow">→</div>
      <div class="flow-node"><div class="flow-label">${esc(to)}</div></div>
    </div>`;
}

function resultPage(attempt, variant) {
  const heading = variant === 'success' ? 'Role assigned'
    : variant === 'error' ? 'Verification could not be completed'
    : 'No role assigned';
  const title = variant === 'success' ? 'Relay — Verification complete' : 'Relay — Result';
  const message = variant === 'success'
    ? 'Identity verified and routed successfully.'
    : variant === 'error'
      ? 'The verification result could not be used. No role was assigned.'
      : 'Verification completed, but this result did not meet the role\u2019s requirements.';

  return page(title, `
    ${flowCard('Discord', 'Relay', attempt.providerLabel.startsWith('MOCK') ? 'ID.me (simulated)' : 'ID.me')}
    ${statusCard(variant, heading, message)}
    <div class="detail-panel">
      <div class="detail-panel-title">Details</div>
      <pre>${esc(formatAttempt(attempt))}</pre>
    </div>
    <p class="mode-line">${esc(providerModeBanner())}</p>
  `);
}

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<link rel="icon" type="image/webp" href="${FAVICON_SRC}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --slate: ${BRAND.slate}; --blue: ${BRAND.blue}; --teal: ${BRAND.teal};
    --violet: ${BRAND.violet}; --white: ${BRAND.white}; --gray: ${BRAND.gray};
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--white); color: var(--slate);
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 16px; line-height: 1.55;
  }
  .topbar {
    background: var(--slate); color: var(--white); padding: 0.9rem 1.5rem;
    display: flex; align-items: center; gap: 0.65rem;
  }
  .brand-mark { display: block; height: 20px; width: auto; }
  .brand-chip {
    display: inline-flex; align-items: center; background: #fff;
    border-radius: 7px; padding: 3px 5px; line-height: 0;
  }
  .topbar-word { font-weight: 700; font-size: 1.05rem; letter-spacing: -0.01em; }
  main { max-width: 40rem; margin: 0 auto; padding: 2rem 1.25rem 3rem; }
  h1 { font-size: 1.4rem; font-weight: 600; margin: 0 0 1.25rem; letter-spacing: -0.01em; }

  .flow-card {
    display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;
    background: #fff; border: 1px solid #E2E8F0; border-radius: 10px;
    padding: 1rem; margin-bottom: 1.25rem;
  }
  .flow-node { text-align: center; flex: 1; min-width: 0; }
  .flow-node-brand { display: flex; flex-direction: column; align-items: center; gap: 0.35rem; }
  .flow-label {
    font-size: 0.82rem; font-weight: 500; color: var(--slate);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .flow-arrow { color: var(--gray); font-size: 1.1rem; flex-shrink: 0; }
  .flow-node-brand .brand-mark { height: 28px; }

  .status-card {
    display: flex; gap: 0.75rem; align-items: flex-start;
    border: 1px solid; border-radius: 10px; padding: 1rem 1.1rem; margin-bottom: 1.25rem;
  }
  .status-icon {
    flex-shrink: 0; width: 22px; height: 22px; border-radius: 50%; color: #fff;
    display: flex; align-items: center; justify-content: center;
    font-size: 0.8rem; font-weight: 700; margin-top: 0.1rem;
  }
  .status-heading { font-weight: 600; margin-bottom: 0.2rem; }
  .status-message { color: #334155; font-size: 0.95rem; }
  .status-footnote { color: #64748B; font-size: 0.85rem; margin-top: 0.4rem; }

  .notice {
    background: #F1F5F9; border: 1px solid #E2E8F0; border-radius: 10px;
    padding: 0.9rem 1.1rem; margin-bottom: 1.25rem; font-size: 0.92rem; color: #334155;
  }

  .detail-table { border-collapse: collapse; width: 100%; margin-bottom: 1.25rem; }
  .detail-table th, .detail-table td {
    text-align: left; padding: 0.45rem 1rem 0.45rem 0; border-bottom: 1px solid #E2E8F0;
    font-size: 0.92rem;
  }
  .detail-table th { color: var(--gray); font-weight: 500; width: 9rem; }

  .detail-panel {
    background: #fff; border: 1px solid #E2E8F0; border-radius: 10px;
    padding: 1rem 1.1rem; margin-bottom: 1rem;
  }
  .detail-panel-title { font-weight: 600; font-size: 0.85rem; color: var(--gray);
    text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 0.6rem; }
  .detail-panel-time { font-size: 0.8rem; color: var(--gray); margin-bottom: 0.4rem; }
  pre {
    margin: 0; font: 13px/1.6 ui-monospace, 'SF Mono', Consolas, monospace;
    white-space: pre-wrap; color: #1E293B;
  }
  code {
    background: #F1F5F9; padding: 0.1rem 0.4rem; border-radius: 4px;
    font-size: 0.9em;
  }

  .mode-line { color: var(--gray); font-size: 0.85rem; }
  .muted { color: var(--gray); }

  .btn-primary {
    background: var(--blue); color: #fff; border: 0; border-radius: 8px;
    padding: 0.65rem 1.5rem; font-size: 1rem; font-weight: 500; cursor: pointer;
    font-family: inherit;
  }
  .btn-primary:hover { background: #1D4ED8; }
</style></head><body>
<div class="topbar"><span class="brand-chip">${LOGO_IMG}</span><span class="topbar-word">Relay</span></div>
<main><h1>${esc(title)}</h1>${body}</main>
</body></html>`;
}
