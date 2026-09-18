import { PermissionsBitField } from 'discord.js';
import { config } from '../config.js';
import { logError } from '../diagnostics.js';

/**
 * Assigning the role, and — just as important — refusing to claim success
 * when Discord did not actually apply it.
 *
 * Every exit returns { ok, code, message }. `ok: true` is only ever returned
 * after Discord confirms the member holds the role.
 */

export const RoleOutcome = {
  ASSIGNED: 'ASSIGNED',
  ALREADY_HAD_ROLE: 'ALREADY_HAD_ROLE',
  GUILD_UNAVAILABLE: 'GUILD_UNAVAILABLE',
  NOT_A_MEMBER: 'NOT_A_MEMBER',
  ROLE_NOT_FOUND: 'ROLE_NOT_FOUND',
  MISSING_MANAGE_ROLES: 'MISSING_MANAGE_ROLES',
  ROLE_HIERARCHY: 'ROLE_HIERARCHY',
  ROLE_IS_MANAGED: 'ROLE_IS_MANAGED',
  DISCORD_API_ERROR: 'DISCORD_API_ERROR',
  NOT_VERIFIED_AFTER_ADD: 'NOT_VERIFIED_AFTER_ADD',
};

const fail = (code, message) => ({ ok: false, code, message });

/**
 * Everything that can be checked WITHOUT looking up a specific member:
 * does the guild exist, does the role exist, can the bot manage roles at
 * all, and does its position sit above the target role. Split out so the
 * startup preflight can run these checks directly instead of inferring
 * them from the side effects of a member lookup that was never reliable
 * (see git history — a placeholder user id surfaces as "Unknown User" or
 * "Unknown Member" depending on Discord's mood, not something worth
 * depending on).
 */
async function resolveRoleContext(client) {
  const guildId = config.discord.guildId;
  const roleId = config.discord.veteranRoleId;

  let guild;
  try {
    guild = await client.guilds.fetch(guildId);
  } catch (err) {
    logError('role_guild_fetch_failed', err, { guildId });
    return fail(RoleOutcome.GUILD_UNAVAILABLE, `Bot cannot reach guild ${guildId}. Is it still in the server?`);
  }

  let role;
  try {
    role = await guild.roles.fetch(roleId);
  } catch (err) {
    logError('role_fetch_failed', err, { roleId });
    role = null;
  }
  if (!role) {
    return fail(RoleOutcome.ROLE_NOT_FOUND, `Role ${roleId} does not exist in ${guild.name}.`);
  }
  if (role.managed) {
    return fail(RoleOutcome.ROLE_IS_MANAGED, `Role "${role.name}" is managed by an integration and cannot be assigned manually.`);
  }

  const me = guild.members.me ?? (await guild.members.fetchMe());
  if (!me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
    return fail(RoleOutcome.MISSING_MANAGE_ROLES, 'Bot is missing the Manage Roles permission.');
  }
  if (me.roles.highest.comparePositionTo(role) <= 0) {
    return fail(
      RoleOutcome.ROLE_HIERARCHY,
      `Bot's highest role ("${me.roles.highest.name}") is not above "${role.name}". `
      + 'Move the bot role higher in Server Settings → Roles.',
    );
  }

  return { ok: true, guild, role };
}

export async function assignVeteranRole(client, { discordUserId, reason }) {
  const context = await resolveRoleContext(client);
  if (!context.ok) return context;
  const { guild, role } = context;

  let member;
  try {
    member = await guild.members.fetch(discordUserId);
  } catch (err) {
    // 10007 = Unknown Member (real account, not in this guild)
    // 10013 = Unknown User (the id doesn't resolve to any Discord account)
    // Both mean "this id is not a usable member of the guild."
    if (err?.code === 10007 || err?.code === 10013) {
      return fail(RoleOutcome.NOT_A_MEMBER, `User ${discordUserId} is not a member of ${guild.name}.`);
    }
    logError('member_fetch_failed', err, { discordUserId });
    return fail(RoleOutcome.DISCORD_API_ERROR, `Could not fetch member: ${err?.message ?? err}`);
  }

  if (member.roles.cache.has(role.id)) {
    return { ok: true, code: RoleOutcome.ALREADY_HAD_ROLE, message: `Member already had "${role.name}".` };
  }

  try {
    await member.roles.add(role, reason);
  } catch (err) {
    logError('role_add_failed', err, { discordUserId, roleId });
    return fail(RoleOutcome.DISCORD_API_ERROR, `Discord rejected the role change: ${err?.message ?? err}`);
  }

  // Do not take the absence of an exception as proof. Re-read from Discord.
  const confirmed = await guild.members.fetch({ user: discordUserId, force: true });
  if (!confirmed.roles.cache.has(role.id)) {
    return fail(RoleOutcome.NOT_VERIFIED_AFTER_ADD, 'Discord accepted the request but the role is not present on re-check.');
  }

  return { ok: true, code: RoleOutcome.ASSIGNED, message: `Assigned "${role.name}".` };
}

/**
 * Startup sanity check so hierarchy problems surface before a live test.
 * Checks guild, role, permission and hierarchy directly — never touches a
 * member, so there is no dependence on how Discord labels a lookup failure.
 */
export async function preflightRoleCheck(client) {
  const context = await resolveRoleContext(client);
  if (!context.ok) return context;
  return { ok: true, code: 'READY', message: 'Guild, role, permission and hierarchy all look correct.' };
}
