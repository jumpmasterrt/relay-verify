import crypto from 'node:crypto';
import { config } from '../config.js';
import { normalizeCommunityPayload } from './normalized.js';

/**
 * MOCK provider. Contacts nothing. Talks to no ID.me system of any kind.
 *
 * It imitates the *shape* of an ID.me community verification result and the
 * *sequence* of an OAuth round trip (redirect -> single-use code -> exchange),
 * so the rest of the application is exercised exactly as it will be in
 * sandbox mode. It does not pretend to be ID.me.
 */

export const MOCK_PROVIDER_LABEL = 'MOCK ID.me (simulated result — NOT a real ID.me verification)';

export const MOCK_SCENARIOS = {
  verified_veteran: {
    label: 'Veteran — Verified',
    expectation: 'Veteran role SHOULD be assigned',
    payload: { uuid: 'mock-subject-0001', group: 'military', subgroups: ['Veteran'], verified: true },
  },
  military_spouse: {
    label: 'Military Spouse — Verified',
    expectation: 'Veteran role should NOT be assigned',
    payload: { uuid: 'mock-subject-0002', group: 'military', subgroups: ['Military Spouse'], verified: true },
  },
  unverified_veteran: {
    label: 'Veteran — Unverified',
    expectation: 'Veteran role should NOT be assigned',
    payload: { uuid: 'mock-subject-0003', group: 'military', subgroups: ['Veteran'], verified: false },
  },
  invalid_result: {
    label: 'Invalid / Error Response',
    expectation: 'Veteran role should NOT be assigned (fail closed)',
    payload: { unexpected: 'this payload is deliberately wrong', verified: 'yes' },
  },
};

export const DEFAULT_SCENARIO = 'verified_veteran';

/** code -> { state, scenario, expiresAt }. Codes are single-use, like real ones. */
const issuedCodes = new Map();

export class MockIdMeProvider {
  constructor() {
    this.label = MOCK_PROVIDER_LABEL;
    this.isMock = true;
  }

  /** No PKCE material needed, but we still generate state so the flow matches. */
  createAuthorizationRequest({ state }) {
    const url = new URL(`${config.publicBaseUrl}/mock/idme/authorize`);
    url.searchParams.set('state', state);
    return { url: url.toString(), codeVerifier: null, nonce: null };
  }

  /** Called by the mock authorization page once the operator clicks Continue. */
  issueAuthorizationCode({ state, scenario }) {
    const code = crypto.randomBytes(24).toString('base64url');
    issuedCodes.set(code, { state, scenario, expiresAt: Date.now() + 120_000 });
    return code;
  }

  /**
   * Stands in for: authorization-code exchange + attributes fetch + normalize.
   * @returns {Promise<NormalizedVerification>}
   */
  async fetchVerification({ code, session }) {
    const entry = issuedCodes.get(code);
    issuedCodes.delete(code); // single use, consumed on first exchange
    if (!entry) throw new Error('mock authorization code is unknown or already used');
    if (entry.expiresAt < Date.now()) throw new Error('mock authorization code expired');
    if (entry.state !== session.state) throw new Error('mock authorization code does not belong to this session');

    const scenario = MOCK_SCENARIOS[entry.scenario] ?? MOCK_SCENARIOS[DEFAULT_SCENARIO];
    return normalizeCommunityPayload(scenario.payload, this.label);
  }
}

export function sweepMockCodes() {
  const now = Date.now();
  for (const [code, entry] of issuedCodes) {
    if (entry.expiresAt < now) issuedCodes.delete(code);
  }
}
