# Relay Verify

**Identity verification → community access.**

Relay Verify is a proof-of-concept bridge that translates a trusted external verification result into a Discord role assignment.

The goal is simple: let an established identity or affiliation provider answer the verification question while Discord remains responsible for community access and permissions.

Relay Verify does **not** perform identity proofing itself.

## Status

> **Proof of concept / technical evaluation**

The current implementation models an **ID.me → Discord** verification workflow using a mock verification provider.

It is intended to demonstrate:

- the end-to-end verification experience
- correlation between a verification session and a Discord user
- verification-policy results driving Discord role assignment
- separation between identity verification and community authorization
- the security and deployment boundaries required for a production implementation

The proof of concept is **not a production ID.me integration** and should not be deployed as one without completing the appropriate integration, security review, configuration, and provider approval process.

## The problem

Discord communities sometimes need to answer a question such as:

> **Has this person actually satisfied the requirement for this role?**

That requirement might be a verified affiliation, credential, membership category, or other trusted attribute.

Manual verification creates several problems:

- moderators become responsible for reviewing sensitive information
- standards can vary between reviewers
- verification does not scale well
- users may reveal more information than is necessary
- community staff may retain documents or personal information they never needed to possess

Relay Verify separates those responsibilities.

The identity provider answers the verification question.

Relay answers only:

> **Did this verification session satisfy the configured policy, and which Discord account should receive the corresponding role?**

## Conceptual flow

```text
Discord user
     │
     ▼
Relay Verify
     │
     ├── Begin verification session
     │
     ▼
Identity provider
     │
     ├── Authentication / verification
     │
     ▼
Relay Verify callback
     │
     ├── Validate result
     ├── Correlate verification session
     ├── Apply configured policy
     │
     ▼
Discord API
     │
     └── Assign configured role
```

The proof of concept uses a **mock verification provider** in place of a live ID.me production transaction.

That boundary is intentional: the prototype can demonstrate Relay's behavior without representing test logic as an authorized production integration.

## Design goals

### Verification belongs with the verification provider

Relay should consume a trusted verification result rather than attempt to recreate identity-proofing logic.

### Collect as little as possible

Successful verification should not require a Discord community to possess copies of identification documents or unrelated personal information.

### Separate verification from authorization

A verified identity or affiliation is one input.

The consuming organization decides what Discord access that result grants.

### Keep organization-specific policy configurable

Role IDs, server IDs, verification policies, branding, deployment settings, and other organization-specific values should remain configuration rather than assumptions built into the core application.

### Use least privilege

The Discord application should receive only the permissions required to perform its job.

### Make the trust boundary obvious

Mock, sandbox, test, and production behavior should be clearly distinguishable.

## Architecture

A production implementation is expected to contain three distinct trust domains:

```text
┌──────────────────────┐
│ Identity provider    │
│                      │
│ Authentication       │
│ Verification         │
│ Verified attributes  │
└──────────┬───────────┘
           │
           │ trusted verification result
           ▼
┌──────────────────────┐
│ Relay Verify         │
│                      │
│ Session correlation  │
│ Policy evaluation    │
│ Minimal audit state  │
│ Role mapping         │
└──────────┬───────────┘
           │
           │ authorized application request
           ▼
┌──────────────────────┐
│ Discord              │
│                      │
│ User / server        │
│ Role assignment      │
│ Community access     │
└──────────────────────┘
```

Relay is the bridge between the two systems. It should not become an unnecessary repository of identity information.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the detailed trust-boundary and data-flow notes.

## Security and privacy expectations

A production implementation should:

- never commit provider credentials or Discord bot tokens to source control
- keep secrets in environment configuration or an appropriate secrets-management system
- validate OAuth/OIDC state and callback handling
- use PKCE when appropriate to the approved integration
- validate tokens and provider responses according to provider requirements
- avoid logging access tokens, identity payloads, or unnecessary personally identifiable information
- retain only the minimum state required to complete and audit a verification transaction
- document data-retention behavior
- use HTTPS for production callbacks
- request only the Discord permissions actually required
- ensure the application's Discord role is positioned correctly in the server role hierarchy
- clearly distinguish mock/sandbox configuration from production configuration

See [`SECURITY.md`](SECURITY.md) for reporting and security expectations.

## What Relay Verify does not do

Relay Verify is not intended to:

- replace an identity provider
- inspect identity documents
- store copies of identity documents
- automate a normal Discord user account
- bypass Discord permissions or role hierarchy
- determine an organization's access policy
- treat mock verification results as production credentials
- ship production secrets in the repository

## Configuration

Deployment-specific values belong outside the application code.

Expected configuration will include values similar to:

```dotenv
# Verification provider
VERIFY_ENVIRONMENT=
VERIFY_CLIENT_ID=
VERIFY_CLIENT_SECRET=
VERIFY_REDIRECT_URI=
VERIFY_POLICY=

# Discord
DISCORD_APPLICATION_ID=
DISCORD_BOT_TOKEN=
DISCORD_GUILD_ID=
DISCORD_VERIFIED_ROLE_ID=

# Application
APP_BASE_URL=
SESSION_SECRET=
```

These names are placeholders until the implementation is uploaded and finalized.

See [`.env.example`](.env.example) for the committed configuration template. Real credentials must never be committed.

## Mock vs. production

### Proof of concept

```text
User
  ↓
Relay
  ↓
Mock verification result
  ↓
Relay policy handling
  ↓
Discord role
```

### Production target

```text
User
  ↓
Relay
  ↓
Approved provider authorization / verification flow
  ↓
Validated provider response
  ↓
Relay policy handling
  ↓
Discord role
```

The mock exists to exercise **Relay's side of the boundary**.

It does not emulate or replace the provider's identity-proofing process.

## Review package

The repository includes three documents specifically for technical review:

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — components, trust boundaries, and intended data flow
- [`docs/IT-REVIEW.md`](docs/IT-REVIEW.md) — focused checklist for application/security reviewers
- [`docs/PRODUCTION-READINESS.md`](docs/PRODUCTION-READINESS.md) — items that must be resolved before a production deployment

## Repository status

Source code will be added after the initial proof-of-concept package is finalized.

The repository is intentionally being prepared before the implementation upload so that the code arrives with its purpose, trust boundaries, assumptions, and review requirements already documented.

## Independence

Relay Verify is an independent proof-of-concept project.

It is not an official product of, endorsed by, or affiliated with ID.me or Discord.

Production use of those services is subject to their respective technical requirements, agreements, policies, and approval processes.
