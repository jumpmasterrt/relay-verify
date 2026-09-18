import { Client, GatewayIntentBits, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { config, isMockMode } from '../config.js';
import { log, logError } from '../diagnostics.js';
import { createSession } from '../sessions.js';
import { MOCK_SCENARIOS, DEFAULT_SCENARIO } from '../verification/mockProvider.js';
import { preflightRoleCheck } from './roles.js';

/**
 * The Discord side does exactly two things: it proves who is asking, and it
 * hands back a link. It makes no eligibility decision and touches no provider.
 */

export const verifyCommand = new SlashCommandBuilder()
  .setName('verify')
  .setDescription('Start military verification to receive the Veteran role')
  .addStringOption((option) =>
    option
      .setName('status')
      .setDescription('Which military status to simulate (mock mode only)')
      .setRequired(false)
      .addChoices(
        ...Object.entries(MOCK_SCENARIOS).map(([value, s]) => ({ name: s.label, value })),
      ));

export function createDiscordClient() {
  // Guilds only. No message content, no member list scraping.
  return new Client({ intents: [GatewayIntentBits.Guilds] });
}

export function attachHandlers(client) {
  // discord.js renamed 'ready' to 'clientReady' mid-v14. Listen for both,
  // run once. Harmless on either version.
  let readyHandled = false;
  const onReady = async () => {
    if (readyHandled) return;
    readyHandled = true;
    log('discord_ready', { user: client.user.tag, guildId: config.discord.guildId });
    const preflight = await preflightRoleCheck(client);
    // NOTE: named "outcome", not anything containing "code" — the logger
    // redacts any field whose NAME even contains that substring, as a
    // precaution against leaking OAuth authorization codes. This is just an
    // enum label (e.g. ROLE_HIERARCHY) and would otherwise get blanked for
    // no reason. (outcomeCode was tried first and still matched — the filter
    // checks substrings, not whole words.)
    log('discord_preflight', { ok: preflight.ok, outcome: preflight.code, message: preflight.message });
    if (!preflight.ok) {
      console.warn('\n  ⚠  Role assignment will fail until this is fixed:\n     ' + preflight.message + '\n');
    }
  };
  client.once('clientReady', onReady);
  client.once('ready', onReady);

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'verify') return;

    try {
      if (!interaction.inGuild() || interaction.guildId !== config.discord.guildId) {
        await interaction.reply({
          content: 'This command only works in the configured server.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // THE BINDING. interaction.user.id is Discord's own authenticated,
      // immutable snowflake for the person who ran the command. It is never
      // read from user input, and never read again from the browser.
      const discordUserId = interaction.user.id;

      const requested = interaction.options.getString('status');
      const scenario = isMockMode() ? (requested ?? DEFAULT_SCENARIO) : null;

      const session = createSession({
        discordUserId,
        guildId: interaction.guildId,
        scenario,
      });

      const link = `${config.publicBaseUrl}/verify/${session.token}`;
      const minutes = Math.round(config.sessionTtlSeconds / 60);

      const lines = [
        '**Military verification**',
        `Continue here (link is personal to you and expires in ~${minutes} minutes):`,
        link,
        '',
      ];
      if (isMockMode()) {
        const s = MOCK_SCENARIOS[scenario];
        lines.push(
          '⚠️ **MOCK MODE** — no real ID.me verification is taking place.',
          `Simulated result: **${s.label}** (${s.expectation})`,
        );
      }

      await interaction.reply({ content: lines.join('\n'), flags: MessageFlags.Ephemeral });
      log('verification_started', { discordUserId, scenario, mock: isMockMode() });
    } catch (err) {
      logError('interaction_failed', err);
      if (interaction.isRepliable() && !interaction.replied) {
        await interaction.reply({
          content: 'Something went wrong starting verification. Check the server logs.',
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
      }
    }
  });
}
