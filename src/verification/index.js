import { config, isMockMode } from '../config.js';
import { MockIdMeProvider } from './mockProvider.js';
import { IdMeSandboxProvider } from './idmeSandboxProvider.js';

/**
 * The provider boundary. Everything upstream of this file is generic:
 * it asks for an authorization URL, then for a normalized verification result.
 * Swapping mock for sandbox is one environment variable.
 */
let provider = null;

export function getProvider() {
  if (!provider) {
    provider = isMockMode() ? new MockIdMeProvider() : new IdMeSandboxProvider();
  }
  return provider;
}

export function providerLabel() {
  return getProvider().label;
}

export function providerModeBanner() {
  return isMockMode()
    ? `MOCK MODE — results are simulated locally. IDME_MODE=${config.idme.mode}`
    : `ID.ME SANDBOX MODE — results come from ID.me. IDME_MODE=${config.idme.mode}`;
}
