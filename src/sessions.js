import crypto from 'node:crypto';
import { config } from './config.js';

/**
 * The heart of the identity binding.
 *
 * A session is created ONLY from a Discord interaction, where Discord has
 * already told us who the user is. The Discord user ID is written once, here,
 * and is never read back from a URL, form field, cookie or callback parameter.
 * The browser only ever carries an opaque random token.
 *
 * In-memory on purpose: sessions live for minutes, and a restart invalidating
 * them is the correct behaviour, not a bug.
 *
 * Lifecycle:  created -> started -> consumed
 */

/** @type {Map<string, Session>} */
const byToken = new Map();
/** @type {Map<string, string>} */
const stateToToken = new Map();

const randomId = () => crypto.randomBytes(32).toString('base64url');

export function createSession({ discordUserId, guildId, scenario = null }) {
  const token = randomId();
  const now = Date.now();
  const session = {
    token,
    discordUserId,          // immutable Discord snowflake, set once
    guildId,
    scenario,               // mock mode only; chosen server-side at creation
    status: 'created',
    createdAt: now,
    expiresAt: now + config.sessionTtlSeconds * 1000,
    state: null,
    nonce: null,
    codeVerifier: null,
  };
  byToken.set(token, session);
  return session;
}

const isExpired = (s) => Date.now() > s.expiresAt;

/**
 * @returns {{ok: true, session: Session} | {ok: false, reason: string}}
 */
export function loadSession(token) {
  if (!token || typeof token !== 'string') return { ok: false, reason: 'missing_session_token' };
  const session = byToken.get(token);
  if (!session) return { ok: false, reason: 'unknown_session' };
  if (isExpired(session)) {
    destroySession(token);
    return { ok: false, reason: 'session_expired' };
  }
  return { ok: true, session };
}

/** created -> started. Records the provider's state/PKCE material. Single use. */
export function startSession(token, { state, nonce = null, codeVerifier = null }) {
  const loaded = loadSession(token);
  if (!loaded.ok) return loaded;
  const { session } = loaded;
  if (session.status !== 'created') {
    return { ok: false, reason: `session_already_${session.status}` };
  }
  session.status = 'started';
  session.state = state;
  session.nonce = nonce;
  session.codeVerifier = codeVerifier;
  stateToToken.set(state, token);
  return { ok: true, session };
}

/** Look a session up from the callback's `state` parameter. */
export function loadSessionByState(state) {
  if (!state || typeof state !== 'string') return { ok: false, reason: 'missing_state' };
  const token = stateToToken.get(state);
  if (!token) return { ok: false, reason: 'unknown_or_replayed_state' };
  const loaded = loadSession(token);
  if (!loaded.ok) return loaded;
  if (loaded.session.status !== 'started') {
    return { ok: false, reason: `session_not_awaiting_callback (${loaded.session.status})` };
  }
  return loaded;
}

/**
 * started -> consumed. Called at the TOP of the callback, before the token
 * exchange, so a replayed callback finds nothing left to use.
 */
export function consumeSession(token) {
  const loaded = loadSession(token);
  if (!loaded.ok) return loaded;
  const { session } = loaded;
  if (session.status !== 'started') return { ok: false, reason: `session_${session.status}` };
  session.status = 'consumed';
  if (session.state) stateToToken.delete(session.state);
  return { ok: true, session };
}

export function destroySession(token) {
  const session = byToken.get(token);
  if (session?.state) stateToToken.delete(session.state);
  byToken.delete(token);
}

/** Drop expired sessions so the maps do not grow forever. */
export function sweepSessions() {
  let removed = 0;
  for (const [token, session] of byToken) {
    if (isExpired(session)) {
      destroySession(token);
      removed += 1;
    }
  }
  return removed;
}

export function sessionCount() {
  return byToken.size;
}
