import 'dotenv/config';

const str = (key, fallback = '') => (process.env[key] ?? fallback).trim();
const int = (key, fallback) => {
  const n = Number.parseInt(str(key), 10);
  return Number.isFinite(n) ? n : fallback;
};
const bool = (key, fallback = false) => {
  const v = str(key).toLowerCase();
  if (v === '') return fallback;
  return v === 'true' || v === '1' || v === 'yes';
};

export const MODE_MOCK = 'mock';
export const MODE_SANDBOX = 'idme_sandbox';

const publicBaseUrl = str('PUBLIC_BASE_URL', 'http://localhost:3000').replace(/\/+$/, '');
const mode = str('IDME_MODE', MODE_MOCK).toLowerCase();

export const config = {
  port: int('PORT', 3000),
  publicBaseUrl,
  sessionTtlSeconds: int('SESSION_TTL_SECONDS', 600),
  diagnosticsToken: str('DIAGNOSTICS_TOKEN'),
  // Require the callback to arrive in the same browser that started the flow.
  // See README: in-app browsers on mobile can break this.
  requireSameBrowser: bool('REQUIRE_SAME_BROWSER', true),

  discord: {
    botToken: str('DISCORD_BOT_TOKEN'),
    clientId: str('DISCORD_CLIENT_ID'),
    clientSecret: str('DISCORD_CLIENT_SECRET'),
    redirectUri: str('DISCORD_REDIRECT_URI'),
    guildId: str('DISCORD_GUILD_ID'),
    veteranRoleId: str('DISCORD_VERIFIED_VETERAN_ROLE_ID'),
  },

  idme: {
    mode,
    clientId: str('IDME_CLIENT_ID'),
    clientSecret: str('IDME_CLIENT_SECRET'),
    authUrl: str('IDME_AUTH_URL'),
    tokenUrl: str('IDME_TOKEN_URL'),
    attributesUrl: str('IDME_ATTRIBUTES_URL'),
    // Falls back to our own callback path so mock mode needs no config at all.
    redirectUri: str('IDME_REDIRECT_URI') || `${publicBaseUrl}/verify/callback`,
    scopes: str('IDME_SCOPES'),
    op: str('IDME_OP'),
    attributesAuth: (str('IDME_ATTRIBUTES_AUTH', 'auto') || 'auto').toLowerCase(),
    usePkce: bool('IDME_USE_PKCE', true),
    logPayloadKeys: bool('IDME_LOG_PAYLOAD_KEYS', false),
  },
};

export const isMockMode = () => config.idme.mode === MODE_MOCK;

/**
 * Fail fast and loudly. Mock mode must start with zero ID.me values;
 * sandbox mode must refuse to start with any of them missing, because a
 * half-configured OAuth client fails in confusing ways at the callback.
 */
export function validateConfig() {
  const errors = [];
  const warnings = [];

  if (![MODE_MOCK, MODE_SANDBOX].includes(config.idme.mode)) {
    errors.push(`IDME_MODE must be "${MODE_MOCK}" or "${MODE_SANDBOX}" (got "${config.idme.mode}")`);
  }

  for (const [key, value] of Object.entries({
    DISCORD_BOT_TOKEN: config.discord.botToken,
    DISCORD_CLIENT_ID: config.discord.clientId,
    DISCORD_GUILD_ID: config.discord.guildId,
    DISCORD_VERIFIED_VETERAN_ROLE_ID: config.discord.veteranRoleId,
  })) {
    if (!value) errors.push(`${key} is required`);
  }

  if (!config.diagnosticsToken) {
    warnings.push('DIAGNOSTICS_TOKEN is not set — the /diagnostics page will refuse all requests.');
  }

  if (config.idme.mode === MODE_SANDBOX) {
    for (const [key, value] of Object.entries({
      IDME_CLIENT_ID: config.idme.clientId,
      IDME_AUTH_URL: config.idme.authUrl,
      IDME_TOKEN_URL: config.idme.tokenUrl,
      IDME_ATTRIBUTES_URL: config.idme.attributesUrl,
      IDME_REDIRECT_URI: config.idme.redirectUri,
      IDME_SCOPES: config.idme.scopes,
    })) {
      if (!value) errors.push(`${key} is required when IDME_MODE=${MODE_SANDBOX}`);
    }
    // A local test harness (this project ships one — see scripts/) talks
    // over plain http on localhost by design; that's not a real deployment,
    // so it gets a warning, not a hard failure. Anything pointed at real
    // ID.me infrastructure still must be https, no exceptions.
    const pointedAtLocalHarness = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(config.idme.authUrl || '');
    if (!config.publicBaseUrl.startsWith('https://')) {
      if (pointedAtLocalHarness) {
        warnings.push('PUBLIC_BASE_URL is not https, but IDME_AUTH_URL points at localhost — assuming this is the local test harness, not real ID.me.');
      } else {
        errors.push('PUBLIC_BASE_URL must be https:// in sandbox mode (ID.me will not redirect to plain http).');
      }
    }
  }

  if (config.idme.mode === MODE_MOCK && !config.publicBaseUrl.startsWith('https://')) {
    warnings.push('PUBLIC_BASE_URL is not https — fine for a local mock test, not for anything real.');
  }

  return { errors, warnings };
}
