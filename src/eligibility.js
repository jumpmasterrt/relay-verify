/**
 * The Veteran decision. One pure function, no Discord, no HTTP, no provider
 * JSON. Given a NormalizedVerification it returns a decision and a reason.
 *
 *   eligible = result is valid
 *              AND group == "military"
 *              AND verified == true
 *              AND "Veteran" appears in subgroups
 *
 * Deliberately narrow: other military subgroups (spouse, active duty,
 * dependent) do NOT qualify for this role.
 */

export const REQUIRED_GROUP = 'military';
export const REQUIRED_SUBGROUP = 'Veteran';

export function evaluateVeteranEligibility(result) {
  if (!result || typeof result !== 'object') {
    return deny('no_verification_result');
  }
  if (result.group?.toLowerCase() !== REQUIRED_GROUP) {
    return deny(`group is "${result.group}", required "${REQUIRED_GROUP}"`);
  }
  if (result.verified !== true) {
    return deny('verification result is not verified');
  }
  const target = REQUIRED_SUBGROUP.toLowerCase();
  // Exact match on a whole subgroup value. Never a substring test —
  // "Veteran Spouse" must not satisfy "Veteran".
  const hasVeteran = Array.isArray(result.subgroups)
    && result.subgroups.some((s) => String(s).trim().toLowerCase() === target);
  if (!hasVeteran) {
    return deny(`subgroups ${JSON.stringify(result.subgroups ?? [])} do not include "${REQUIRED_SUBGROUP}"`);
  }
  return { eligible: true, reason: 'Veteran eligible' };
}

function deny(reason) {
  return { eligible: false, reason: `Not eligible — ${reason}` };
}
