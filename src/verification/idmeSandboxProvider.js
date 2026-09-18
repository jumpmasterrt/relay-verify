import crypto from 'node:crypto';
import { config } from '../config.js';
import { log } from '../diagnostics.js';
import { normalizeCommunityPayload, describeShape, VerificationFormatError } from './normalized.js';

/**
 * Real ID.me provider — standard OAuth 2.0 authorization-code flow with
 * optional PKCE, written against generic, documented OAuth/OIDC behaviour.
 *
 * Every value that is specific to ID.me (endpoints, scopes, policy identifier,
 * payload field names) is either read from configuration or isolated in a
 * clearly marked spot below. Nothing about ID.me is invented or hard-coded here.
 *
 * Endpoint paths, parameter names and the attributes payload shape below are
 * taken from ID.me's published developer documentation (docs.id.me). The
 * client_id, client_secret, scope/policy handle and redirect URI are yours and
 * come only from your own registered application.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ TO GO LIVE ON SANDBOX:                                                  │
 * │  1. Fill every IDME_* value in .env from your approved sandbox config.  │
 * │  2. Set IDME_MODE=idme_sandbox.                                         │
 * │  3. Set IDME_LOG_PAYLOAD_KEYS=true for the first run. The server logs   │
 * │     the attributes response *shape* (key names + value types, never     │
 * │     values). If the shape does not match what normalizeCommunityPayload │
 * │     expects, fix it in normalized.js — nothing else needs to change.    │
 * │  4. Set IDME_LOG_PAYLOAD_KEYS back to false.                            │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

export class IdMeSandboxProvider {
  constructor() {
    this.label = 'ID.me sandbox';
    this.isMock = false;
  }

  createAuthorizationRequest({ state }) {
    const url = new URL(config.idme.authUrl);
    url.searchParams.set('client_id', config.idme.clientId);
    url.searchParams.set('redirect_uri', config.idme.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', config.idme.scopes);
    url.searchParams.set('state', state);

    const nonce = crypto.randomBytes(16).toString('base64url');
    url.searchParams.set('nonce', nonce);

    // The ID.me "policy" is NOT a separate parameter — it IS the scope.
    // IDME_SCOPES must exactly match the policy handle assigned to your
    // consumer (e.g. `military`). For OIDC, prepend `openid `.
    //
    // `op` is unrelated: it is an optional hint with the documented values
    // `signin` and `signup`. Left unset unless you have a reason.
    if (config.idme.op) {
      url.searchParams.set('op', config.idme.op);
    }

    let codeVerifier = null;
    if (config.idme.usePkce) {
      codeVerifier = crypto.randomBytes(48).toString('base64url'); // 43–128 chars
      const challenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
      url.searchParams.set('code_challenge', challenge);
      url.searchParams.set('code_challenge_method', 'S256');
    }

    return { url: url.toString(), codeVerifier, nonce };
  }

  /**
   * Authorization code -> access token -> verification attributes -> normalized.
   * @returns {Promise<NormalizedVerification>}
   */
  async fetchVerification({ code, session }) {
    const accessToken = await this.#exchangeCode(code, session.codeVerifier);
    const payload = await this.#fetchAttributes(accessToken);

    if (config.idme.logPayloadKeys) {
      // Structure only. No values. Delete this line once the mapping is confirmed.
      log('idme_attributes_shape', { shape: describeShape(payload) });
    }

    try {
      return normalizeCommunityPayload(payload, this.label);
    } catch (err) {
      if (err instanceof VerificationFormatError) {
        // >>> If you land here on a real sandbox response, the payload is valid
        // but shaped differently than normalizeCommunityPayload expects.
        // Fix the mapping in src/verification/normalized.js. Do not loosen the
        // eligibility rule to compensate.
        throw new VerificationFormatError(
          `ID.me attributes payload did not match the expected mapping: ${err.message}`,
        );
      }
      throw err;
    }
  }

  async #exchangeCode(code, codeVerifier) {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.idme.redirectUri,
      client_id: config.idme.clientId,
    });
    if (config.idme.clientSecret) body.set('client_secret', config.idme.clientSecret);
    if (codeVerifier) body.set('code_verifier', codeVerifier);

    const res = await fetch(config.idme.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body,
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      // Status only — the response body of a failed token exchange can echo the code.
      throw new Error(`token exchange failed with HTTP ${res.status}`);
    }

    const json = await res.json();
    const accessToken = json?.access_token;
    if (typeof accessToken !== 'string' || !accessToken) {
      throw new Error('token response contained no access_token');
    }
    return accessToken;
  }

  /**
   * ID.me's published examples pass the token as an `access_token` query
   * parameter; a bearer header is the more usual OAuth convention and is also
   * accepted. Rather than guess, try the header first and fall back once to
   * the query form on a 401/403, then log which one worked so you can pin it
   * with IDME_ATTRIBUTES_AUTH and drop the fallback.
   */
  async #fetchAttributes(accessToken) {
    const mode = config.idme.attributesAuth; // 'bearer' | 'query' | 'auto'
    const order = mode === 'auto' ? ['bearer', 'query'] : [mode];

    let lastStatus = null;
    for (const attempt of order) {
      const url = new URL(config.idme.attributesUrl);
      const headers = { Accept: 'application/json' };
      if (attempt === 'bearer') headers.Authorization = `Bearer ${accessToken}`;
      else url.searchParams.set('access_token', accessToken);

      const res = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(15_000) });

      if (res.ok) {
        if (mode === 'auto') log('idme_attributes_auth_mode', { worked: attempt });
        return res.json();
      }
      lastStatus = res.status;
      if (res.status !== 401 && res.status !== 403) break; // not an auth problem, stop
    }
    // Status only. A failed response body can echo token material.
    throw new Error(`attributes request failed with HTTP ${lastStatus}`);
  }
}
