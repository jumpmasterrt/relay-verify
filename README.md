# Relay — Verify

Discord role assignment driven by ID.me military verification. A member
runs `/verify`, completes ID.me verification, and the correct Discord role
is assigned automatically — no document photos, no manual moderator review.

Ships with a mock mode that runs the entire pipeline with zero ID.me
credentials, so this can be evaluated as a working proof of concept before
any partner-level ID.me access exists.

---

## Requirements

This app uses Node.js. Your deployment environment will need:

- **Node.js 20 or newer** — `node --version` to check. Get it from
  [nodejs.org](https://nodejs.org) if not already installed.
- **npm** (ships with Node — nothing separate to install).
- **Outbound internet access** from wherever this runs, to reach Discord's
  API and (later) ID.me's API. No inbound access is required for mock mode.
- A **Discord account** with permission to create applications at
  [discord.com/developers](https://discord.com/developers/applications).

## Assumptions

- You have access to a Discord server to test against (a sandbox server,
  not your production community, for the initial pass).
- You have a machine or environment that can run a long-lived Node
  process and reach the internet outbound. A laptop is enough for mock mode.
- Moving beyond mock mode (see below) additionally requires an HTTPS-reachable
  address — a real domain, or a tunnel (Tailscale Funnel, Cloudflare Tunnel)
  pointed at wherever this runs.

---

## 1. Create the Discord bot

1. [discord.com/developers/applications](https://discord.com/developers/applications) → **New Application**.
2. Left sidebar → **Bot** → **Reset Token** (or **Copy**, first time) — this is your `DISCORD_BOT_TOKEN`. Treat it like a password.
3. Same page → turn **Public Bot** off, so only you can add it to servers.
4. Left sidebar → **General Information** → copy **Application ID** — this is `DISCORD_CLIENT_ID`.
5. Left sidebar → **OAuth2 → URL Generator** → check `bot` and `applications.commands` → under Bot Permissions, check only **Manage Roles** → open the generated URL → select your sandbox server to invite the bot.
6. In Discord itself: **User Settings → Advanced → Developer Mode** → on. You'll need this to copy IDs in the next steps.
7. Right-click your sandbox server's icon → **Copy Server ID** — this is `DISCORD_GUILD_ID`.
8. In the server: **Server Settings → Roles → Create Role** (name it something like `ID.me Verified Veteran — TEST`) → right-click it → **Copy Role ID** — this is `DISCORD_VERIFIED_VETERAN_ROLE_ID`.
9. Still in Roles: drag the **bot's own role** above the role you just created. If the bot's role sits below the target role, Discord will not let it assign that role — this is the single most common setup mistake.

## 2. Configure the app

```bash
git clone <this repo>
cd relay-verify
npm install
cp .env.example .env
```

Open `.env` and fill in the values below. Everything not listed here can be
left exactly as shipped for a first mock-mode run.

| Variable | Where to find it |
|---|---|
| `DISCORD_BOT_TOKEN` | Developer Portal → your app → Bot → Token |
| `DISCORD_CLIENT_ID` | Developer Portal → your app → General Information → Application ID |
| `DISCORD_GUILD_ID` | Discord → Developer Mode on → right-click your server → Copy Server ID |
| `DISCORD_VERIFIED_VETERAN_ROLE_ID` | Discord → right-click the role you created → Copy Role ID |
| `DIAGNOSTICS_TOKEN` | Made up by you — any long random string. Gates the `/diagnostics` page. |
| `PUBLIC_BASE_URL` | Leave as `http://localhost:3000` for a first local test |
| `IDME_MODE` | Leave as `mock` — see "Modes" below |

Everything under `IDME_*` besides `IDME_MODE` is only read when
`IDME_MODE=idme_sandbox` or `production` — leave blank for now.

## 3. Run it

```bash
npm run register   # pushes the /verify command to your sandbox server
npm start
```

Watch the console for `discord_preflight` with `"ok":true` — that confirms
the bot, the role, and the role hierarchy are all set up correctly, before
you spend a live test finding out the hard way.

---

## Mock mode: pass/fail criteria

In Discord, run `/verify`, optionally choosing a `status` from the dropdown
(defaults to Veteran — Verified if omitted).

| Pick in the dropdown | Expected outcome |
|---|---|
| Veteran — Verified | Role **is** assigned |
| Military Spouse — Verified | Role **not** assigned |
| Veteran — Unverified | Role **not** assigned |
| Invalid / Error Response | Role **not** assigned (fails closed) |

Two more checks worth running:

- **Bad/expired session:** open `http://localhost:3000/verify/anything` directly — should be rejected, not crash.
- **Role hierarchy failure:** drag the bot's role below the target role in Discord, run Veteran — Verified again — result page should report `FAILED — ROLE_HIERARCHY`, not a false success.

If all six pass, the entire pipeline — Discord identity, session binding,
eligibility logic, and role assignment — is proven correct. The only thing
mock mode doesn't prove is the actual network call to ID.me.

An optional local harness (`npm run idme:fake`) exercises the *real* OAuth
code path — PKCE, token exchange, the attributes fetch — against a stand-in
server, without needing ID.me credentials. See the comments at the top of
`scripts/fake-idme-server.js` for how to point the app at it.

---

## Moving to ID.me sandbox

1. Get sandbox credentials from your ID.me partner contact — this requires an approved ID.me partnership, not something available to an individual.
2. In `.env`, set:
   ```
   IDME_MODE=idme_sandbox
   IDME_CLIENT_ID=<from ID.me>
   IDME_CLIENT_SECRET=<from ID.me>
   IDME_REDIRECT_URI=<your HTTPS callback URL, registered with ID.me exactly>
   IDME_SCOPES=military
   ```
   `IDME_AUTH_URL`, `IDME_TOKEN_URL`, and `IDME_ATTRIBUTES_URL` are already pre-filled for ID.me's sandbox (`api.idmelabs.com`) — leave them as shipped.
3. `PUBLIC_BASE_URL` must be a real `https://` address ID.me's servers can reach — not `localhost`. A tunnel (see Assumptions) or a real domain, either works.
4. Set `IDME_LOG_PAYLOAD_KEYS=true` for the first run only — it logs the *shape* of ID.me's response (field names, not values) so any mapping mismatch is visible immediately. Set it back to `false` once confirmed.
5. Restart, re-run the same test matrix above — this time for real.

The mock-only routes (`/mock/idme/authorize`) automatically disable
themselves outside `IDME_MODE=mock` — nothing to remove by hand.

## Moving to production

Sandbox and production ID.me credentials are separate — sandbox access does
not carry over. Confirm with your ID.me partner contact whether production
requires its own application review.

1. Swap `IDME_AUTH_URL`, `IDME_TOKEN_URL`, and `IDME_ATTRIBUTES_URL` from
   `api.idmelabs.com` to `api.id.me` (same paths, production host).
2. Swap in production `IDME_CLIENT_ID` / `IDME_CLIENT_SECRET`, and register
   the production redirect URI with ID.me — sandbox's registered URI will
   not work here.
3. Point `DISCORD_GUILD_ID` and `DISCORD_VERIFIED_VETERAN_ROLE_ID` at the
   real production server and role, not the sandbox ones.
4. `PUBLIC_BASE_URL` points at the real, permanent hosting address.
5. Re-run `npm run register` for the production guild, and the full test
   matrix one more time before opening it to real members.
