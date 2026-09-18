/**
 * Registers /verify as a guild command in DISCORD_GUILD_ID.
 * Guild commands appear immediately; global ones can take an hour.
 * Run this once, and again any time the command definition changes.
 */
import { REST, Routes } from 'discord.js';
import { config } from '../src/config.js';
import { verifyCommand } from '../src/discord/bot.js';

if (!config.discord.botToken || !config.discord.clientId || !config.discord.guildId) {
  console.error('DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID and DISCORD_GUILD_ID must be set.');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(config.discord.botToken);

await rest.put(
  Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
  { body: [verifyCommand.toJSON()] },
);

console.log(`Registered /verify in guild ${config.discord.guildId}.`);
