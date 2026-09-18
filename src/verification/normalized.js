/**
 * The internal shape the rest of the application is allowed to see.
 *
 * Nothing downstream — not the eligibility rule, not the Discord code — ever
 * touches raw provider JSON. When the real ID.me payload turns out to be
 * shaped slightly differently than expected, this file is the only place that
 * changes.
 *
 * NormalizedVerification:
 *   providerSubjectId : string   stable per-user id from the provider
 *   group             : string   e.g. "military"
 *   subgroups         : string[] e.g. ["Veteran"]
 *   verified          : boolean  strict boolean, never a truthy string
 *   providerLabel     : string   human-readable source of this result
 */

export class VerificationFormatError extends Error {
  constructor(message) {
    super(message);
    this.name = 'VerificationFormatError';
  }
}

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;

/**
 * Parse a provider payload into a NormalizedVerification.
 * Throws VerificationFormatError on anything it does not fully understand —
 * fail closed, never guess.
 *
 * Two accepted shapes:
 *   A) flat     { uuid?, group, subgroups[], verified }
 *   B) wrapped  { attributes:[{handle,name,value}], status:[{group,subgroups[],verified}] }
 *
 * Shape B matches the documented response from ID.me's attributes endpoint
 * (docs.id.me, OAuth 2.0 → Integration): an `attributes` array of
 * {handle, name, value} objects plus a `status` array of
 * {group, subgroups[], verified}. Confirmed against published docs, not
 * guessed — but still verify against your first real sandbox response, since
 * this is the one place a payload change would need fixing.
 */
export function normalizeCommunityPayload(payload, providerLabel) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new VerificationFormatError('payload is not an object');
  }

  let group;
  let subgroups;
  let verified;
  let providerSubjectId;

  if (Array.isArray(payload.status)) {
    const entry = payload.status.find((s) => s && typeof s === 'object');
    if (!entry) throw new VerificationFormatError('status array contained no usable entry');
    ({ group, verified } = entry);
    subgroups = readSubgroups(entry);
    providerSubjectId = readAttribute(payload.attributes, ['uuid', 'sub', 'id']);
  } else {
    ({ group, verified } = payload);
    subgroups = readSubgroups(payload);
    providerSubjectId = payload.uuid ?? payload.sub ?? payload.provider_subject_id;
  }

  if (!isNonEmptyString(group)) {
    throw new VerificationFormatError('missing or invalid "group"');
  }
  if (!Array.isArray(subgroups) || !subgroups.every(isNonEmptyString)) {
    throw new VerificationFormatError('missing or invalid "subgroups" (expected array of strings)');
  }
  if (typeof verified !== 'boolean') {
    throw new VerificationFormatError('missing or invalid "verified" (expected a real boolean)');
  }
  if (!isNonEmptyString(providerSubjectId)) {
    throw new VerificationFormatError('missing provider subject id');
  }

  return Object.freeze({
    providerSubjectId: providerSubjectId.trim(),
    group: group.trim(),
    subgroups: subgroups.map((s) => s.trim()),
    verified,
    providerLabel,
  });
}

/**
 * ID.me's attributes.json shows `subgroups` as an array. The community group
 * reference page lists entries using a singular `subgroup` string. Accept
 * either and always hand back an array. Nothing else in the app has to care.
 */
function readSubgroups(entry) {
  if (Array.isArray(entry.subgroups)) return entry.subgroups;
  if (typeof entry.subgroup === 'string') return entry.subgroup ? [entry.subgroup] : [];
  return entry.subgroups; // wrong type — let validation below reject it
}

function readAttribute(attributes, handles) {
  if (!Array.isArray(attributes)) return undefined;
  for (const handle of handles) {
    const hit = attributes.find((a) => a && a.handle === handle);
    if (hit && isNonEmptyString(hit.value)) return hit.value;
  }
  return undefined;
}

/** Key names and value types only — never values. Used to map a first sandbox response. */
export function describeShape(value, depth = 0) {
  if (depth > 3) return '…';
  if (Array.isArray(value)) return value.length ? [describeShape(value[0], depth + 1)] : [];
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, describeShape(v, depth + 1)]));
  }
  return typeof value;
}
