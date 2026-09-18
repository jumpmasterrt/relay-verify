import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import { MOCK_SCENARIOS, DEFAULT_SCENARIO } from '../src/verification/mockProvider.js';

/**
 * A local stand-in for ID.me's OAuth/OIDC endpoints. This is NOT ID.me and
 * never touches the internet — its only job is to let IdMeSandboxProvider's
 * REAL code (PKCE generation, the token-exchange POST, the attributes GET
 * with its header/query fallback) actually execute against something that
 * speaks the protocol, instead of being checked only against documentation.
 *
 * Point IDME_AUTH_URL / IDME_TOKEN_URL / IDME_ATTRIBUTES_URL at this server
 * (see README "Testing the real OAuth code path" section) and run the main
 * app with IDME_MODE=idme_sandbox. Two local processes, no network, and the
 * one big untested seam gets exercised for real.
 *
 * Bonus: this works before ID.me sandbox access is ever approved, so it's
 * useful to whoever ends up running this app in production too, not just
 * during this prototype's development.
 */

const PORT = Number.parseInt(process.env.FAKE_IDME_PORT ?? '4000', 10);

// When true, the attributes endpoint always rejects a Bearer header with a
// 401, forcing IDME_ATTRIBUTES_AUTH=auto to fall through to its query-param
// branch. Without this, that fallback code path never actually runs in a
// passing test — the header attempt would just succeed every time.
const FORCE_QUERY_AUTH = (process.env.FAKE_IDME_FORCE_QUERY_AUTH ?? 'false').toLowerCase() === 'true';

const app = express();
app.use(express.urlencoded({ extended: false }));

/** authorization code -> { scenario, codeChallenge, clientId, expiresAt } */
const codes = new Map();
/** access token -> { scenario, expiresAt } */
const tokens = new Map();

const randomToken = () => crypto.randomBytes(24).toString('base64url');

/**
 * The mock provider only ever exercises the FLAT payload shape. ID.me's
 * documented attributes response uses the WRAPPED shape instead (an
 * `attributes` array plus a `status` array) — this is what actually proves
 * that second parsing path in normalizeCommunityPayload works, using the
 * same scenario data as the mock provider so there's one source of truth.
 */
function scenarioPayloadWrapped(key) {
  const scenario = MOCK_SCENARIOS[key] ?? MOCK_SCENARIOS[DEFAULT_SCENARIO];
  const p = scenario.payload;
  if (key === 'invalid_result') return p; // deliberately malformed either way
  return {
    attributes: [
      { handle: 'uuid', name: 'Unique Identifier', value: p.uuid },
      { handle: 'email', name: 'Email', value: 'harness-test@example.invalid' },
    ],
    status: [{ group: p.group, subgroups: p.subgroups, verified: p.verified }],
  };
}

// ── Step 1: authorization endpoint ──────────────────────────────────────────
app.get('/oauth/authorize', (req, res) => {
  const { state, redirect_uri: redirectUri, client_id: clientId, code_challenge: codeChallenge } = req.query;
  const options = Object.entries(MOCK_SCENARIOS)
    .map(([value, s]) => `<option value="${value}">${s.label}</option>`).join('');
  res.send(`<!doctype html><html><body style="font:15px sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;">
    <h2>Fake ID.me — test harness</h2>
    <p>This is the local stand-in, not ID.me. Pick what this login should return; the
       real <code>IdMeSandboxProvider</code> code handles everything from here.</p>
    <form method="post" action="/oauth/authorize">
      <input type="hidden" name="state" value="${state ?? ''}">
      <input type="hidden" name="redirect_uri" value="${redirectUri ?? ''}">
      <input type="hidden" name="client_id" value="${clientId ?? ''}">
      <input type="hidden" name="code_challenge" value="${codeChallenge ?? ''}">
      <p><select name="scenario" style="font-size:1rem;padding:0.4rem;">${options}</select></p>
      <button type="submit" style="font-size:1rem;padding:0.5rem 1.2rem;">Continue</button>
    </form>
  </body></html>`);
});

app.post('/oauth/authorize', (req, res) => {
  const { state, redirect_uri: redirectUri, client_id: clientId, code_challenge: codeChallenge, scenario } = req.body;
  if (!redirectUri) return res.status(400).send('missing redirect_uri');

  const code = randomToken();
  codes.set(code, {
    scenario: scenario || DEFAULT_SCENARIO,
    codeChallenge: codeChallenge || null,
    clientId: clientId || null,
    expiresAt: Date.now() + 120_000,
  });

  const url = new URL(redirectUri);
  url.searchParams.set('code', code);
  if (state) url.searchParams.set('state', state);
  res.redirect(url.toString());
});

// ── Step 2: token endpoint ───────────────────────────────────────────────────
app.post('/oauth/token', (req, res) => {
  const { grant_type: grantType, code, code_verifier: codeVerifier, client_id: clientId } = req.body;
  if (grantType !== 'authorization_code') {
    return res.status(400).json({ error: 'unsupported_grant_type' });
  }

  const entry = codes.get(code);
  if (!entry) {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'unknown or already-used code' });
  }
  codes.delete(code); // single-use, same discipline as a real authorization code

  if (entry.expiresAt < Date.now()) {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'code expired' });
  }
  if (entry.clientId && entry.clientId !== clientId) {
    return res.status(400).json({ error: 'invalid_client' });
  }

  if (entry.codeChallenge) {
    if (!codeVerifier) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'code_verifier required' });
    }
    // Real PKCE verification — recompute S256(code_verifier) and compare to
    // the challenge sent at the authorize step. If the app's PKCE math is
    // wrong, this is where it actually gets caught.
    const recomputed = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    if (recomputed !== entry.codeChallenge) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verification failed' });
    }
  }

  const accessToken = randomToken();
  tokens.set(accessToken, { scenario: entry.scenario, expiresAt: Date.now() + 120_000 });
  res.json({ access_token: accessToken, token_type: 'bearer', expires_in: 120 });
});

// ── Step 3: attributes endpoint ──────────────────────────────────────────────
app.get('/api/public/v3/attributes.json', (req, res) => {
  const authHeader = req.headers.authorization;
  const headerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const queryToken = typeof req.query.access_token === 'string' ? req.query.access_token : null;

  if (headerToken && FORCE_QUERY_AUTH) {
    return res.status(401).json({ error: 'invalid_token', error_description: 'header auth disabled by harness config' });
  }

  const entry = tokens.get(headerToken) ?? tokens.get(queryToken);
  if (!entry) return res.status(401).json({ error: 'invalid_token' });
  if (entry.expiresAt < Date.now()) return res.status(401).json({ error: 'invalid_token', error_description: 'expired' });

  res.json(scenarioPayloadWrapped(entry.scenario));
});

app.listen(PORT, () => {
  console.log(`\n  Fake ID.me test harness listening on http://localhost:${PORT}`);
  console.log(`  FAKE_IDME_FORCE_QUERY_AUTH=${FORCE_QUERY_AUTH}\n`);
});
