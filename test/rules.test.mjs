/**
 * Offline checks for the two pieces that need no Discord and no network:
 * the payload normalizer and the Veteran rule. Run with `npm test`.
 * These cover the logic behind Test 1–4; Tests 5 and 6 are live Discord tests.
 */
import { evaluateVeteranEligibility } from '../src/eligibility.js';
import { normalizeCommunityPayload, VerificationFormatError } from '../src/verification/normalized.js';
import { MOCK_SCENARIOS } from '../src/verification/mockProvider.js';

let pass = 0, fail = 0;
const check = (name, cond) => {
  if (cond) { pass += 1; console.log('  ok   ' + name); }
  else { fail += 1; console.log('  FAIL ' + name); }
};
const norm = (p) => normalizeCommunityPayload(p, 'test');
const eligibleFor = (p) => evaluateVeteranEligibility(norm(p)).eligible;

// Test 1–3, driven by the same payloads the mock provider serves.
check('T1 verified Veteran -> eligible', eligibleFor(MOCK_SCENARIOS.verified_veteran.payload) === true);
check('T2 Military Spouse -> not eligible', eligibleFor(MOCK_SCENARIOS.military_spouse.payload) === false);
check('T3 Veteran, unverified -> not eligible', eligibleFor(MOCK_SCENARIOS.unverified_veteran.payload) === false);

// Test 4: malformed payloads must throw, never normalize into something usable.
const malformed = [
  MOCK_SCENARIOS.invalid_result.payload,
  null,
  'a string',
  { uuid: 'a', group: 'military', subgroups: ['Veteran'], verified: 'true' }, // string, not boolean
  { uuid: 'a', group: 'military', subgroups: 'Veteran', verified: true },     // not an array
  { group: 'military', subgroups: ['Veteran'], verified: true },              // no subject id
];
for (const bad of malformed) {
  let threw = false;
  try { norm(bad); } catch (err) { threw = err instanceof VerificationFormatError; }
  check('T4 rejected: ' + JSON.stringify(bad), threw);
}

// Both accepted payload shapes must produce an identical normalized result.
const wrapped = norm({
  attributes: [{ handle: 'uuid', name: 'UUID', value: 'abc-123' }],
  status: [{ group: 'military', subgroups: ['Veteran'], verified: true }],
});
const flat = norm({ uuid: 'abc-123', group: 'military', subgroups: ['Veteran'], verified: true });
check('wrapped and flat shapes normalize identically', JSON.stringify(wrapped) === JSON.stringify(flat));

// The exact documented ID.me attributes.json payload must normalize cleanly.
const idmeDocShape = {
  attributes: [
    { handle: 'fname', name: 'First Name', value: 'Sean' },
    { handle: 'lname', name: 'Last Name', value: 'Moen' },
    { handle: 'email', name: 'Email', value: 'sean.moen@id.me' },
    { handle: 'uuid', name: 'Unique Identifier', value: 'd733a89e2e634f04ac2fe66c97f71612' },
    { handle: 'zip', name: 'Postal Code', value: '44058-1478' },
  ],
  status: [{ group: 'military', subgroups: ['Service Member'], verified: true }],
};
check('documented ID.me payload normalizes', norm(idmeDocShape).providerSubjectId === 'd733a89e2e634f04ac2fe66c97f71612');
check('Service Member is NOT a Veteran', eligibleFor(idmeDocShape) === false);

const veteranDocShape = {
  ...idmeDocShape,
  status: [{ group: 'military', subgroups: ['Veteran'], verified: true }],
};
check('documented payload with Veteran -> eligible', eligibleFor(veteranDocShape) === true);

// The community reference page lists entries with a singular `subgroup`.
check('singular subgroup form accepted',
  eligibleFor({ uuid: 'a', group: 'military', subgroup: 'Veteran', verified: true }) === true);
check('singular subgroup, wrong value -> not eligible',
  eligibleFor({ uuid: 'a', group: 'military', subgroup: 'Retiree', verified: true }) === false);

// Every other documented military subgroup must be refused.
for (const sg of ['Service Member', 'Retiree', 'Military Spouse', 'Military Family', 'Surviving Spouse']) {
  check(`"${sg}" -> not eligible`,
    eligibleFor({ uuid: 'a', group: 'military', subgroups: [sg], verified: true }) === false);
}

// The rule must not quietly broaden.
check('"Veteran Spouse" does not satisfy "Veteran"',
  eligibleFor({ uuid: 'a', group: 'military', subgroups: ['Veteran Spouse'], verified: true }) === false);
check('casing is ignored on an exact match',
  eligibleFor({ uuid: 'a', group: 'military', subgroups: ['veteran'], verified: true }) === true);
check('wrong group -> not eligible',
  eligibleFor({ uuid: 'a', group: 'student', subgroups: ['Veteran'], verified: true }) === false);
check('missing result -> not eligible', evaluateVeteranEligibility(null).eligible === false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
