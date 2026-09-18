/**
 * Logging + the short in-memory record of verification attempts.
 *
 * Rule for this whole file: secrets, tokens and authorization codes never
 * reach stdout or the diagnostics page. Anything that even smells like one
 * gets replaced before it is printed.
 */

const SECRET_KEY_PATTERN = /(token|secret|code|password|authorization|verifier|cookie|bearer)/i;
const MAX_ATTEMPTS = 25;

/** Recursively blank out values whose key looks sensitive. */
export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEY_PATTERN.test(k) ? '[redacted]' : redact(v);
    }
    return out;
  }
  return value;
}

export function log(event, fields = {}) {
  const line = { ts: new Date().toISOString(), event, ...redact(fields) };
  console.log(JSON.stringify(line));
}

export function logError(event, err, fields = {}) {
  log(event, { ...fields, error: err?.message ?? String(err) });
}

const attempts = [];

/**
 * @param {object} attempt
 * @param {string} attempt.discordUserId
 * @param {string} attempt.providerLabel
 * @param {string|null} attempt.group
 * @param {string[]} attempt.subgroups
 * @param {boolean|null} attempt.verified
 * @param {string} attempt.eligibility   human-readable decision
 * @param {string} attempt.roleAssignment human-readable outcome
 */
export function recordAttempt(attempt) {
  attempts.unshift({ at: new Date().toISOString(), ...attempt });
  if (attempts.length > MAX_ATTEMPTS) attempts.length = MAX_ATTEMPTS;
  log('verification_attempt', attempt);
}

export function getAttempts() {
  return [...attempts];
}

/** The plain-text block the brief asked for. Also used on the result page. */
export function formatAttempt(a) {
  return [
    `Discord user ID: ${a.discordUserId}`,
    `Verification provider: ${a.providerLabel}`,
    `Group: ${a.group ?? '(none)'}`,
    `Subgroups: ${a.subgroups?.length ? a.subgroups.join(', ') : '(none)'}`,
    `Verified: ${a.verified === null || a.verified === undefined ? '(unknown)' : a.verified}`,
    `Eligibility decision: ${a.eligibility}`,
    `Discord role assignment: ${a.roleAssignment}`,
  ].join('\n');
}
