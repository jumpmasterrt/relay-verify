import { config, validateConfig, isMockMode } from './config.js';
import { log } from './diagnostics.js';
import { createDiscordClient, attachHandlers } from './discord/bot.js';
import { createWebServer } from './web/server.js';
import { sweepSessions } from './sessions.js';
import { sweepMockCodes } from './verification/mockProvider.js';
import { providerModeBanner } from './verification/index.js';

const { errors, warnings } = validateConfig();
for (const w of warnings) console.warn(`  ⚠  ${w}`);
if (errors.length) {
  console.error('\nConfiguration errors — refusing to start:');
  for (const e of errors) console.error(`  ✖  ${e}`);
  console.error('\nCopy .env.example to .env and fill it in.\n');
  process.exit(1);
}

console.log(`\n  ${providerModeBanner()}\n`);

const discord = createDiscordClient();
attachHandlers(discord);
await discord.login(config.discord.botToken);

const app = createWebServer(discord);
app.listen(config.port, () => {
  log('http_listening', { port: config.port, publicBaseUrl: config.publicBaseUrl });
});

setInterval(() => {
  const removed = sweepSessions();
  if (isMockMode()) sweepMockCodes();
  if (removed) log('sessions_swept', { removed });
}, 60_000).unref();

const shutdown = async (signal) => {
  log('shutting_down', { signal });
  await discord.destroy().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
