# Relay Verify Architecture

## Purpose

Relay Verify bridges two separate systems:

1. a trusted identity or affiliation provider that answers a verification question; and
2. Discord, where that verification result is translated into community authorization.

Relay should remain a narrow bridge rather than becoming a new identity provider or a store of identity records.

## Architectural principle

**Verification and authorization are different responsibilities.**

The identity provider determines whether the user satisfies a configured verification policy. Relay maps that trusted result to a configured Discord action. Discord enforces the resulting community permissions.

## High-level components

```text
┌──────────────────────────┐
│ Browser / Discord user   │
└─────────────┬────────────┘
              │
              ▼
┌──────────────────────────┐
│ Relay Verify             │
│ Session initiation       │
│ Correlation state        │
│ Callback handling        │
│ Policy mapping           │
│ Discord role action      │
└───────┬──────────┬───────┘
        │          │
        ▼          ▼
┌──────────────┐  ┌──────────────┐
│ Verification │  │ Discord API  │
│ provider     │  │              │
└──────────────┘  └──────────────┘
```

## Proof-of-concept boundary

The current proof of concept replaces the external verification transaction with a mock provider.

The mock should demonstrate only the application-facing contract: begin a transaction, return a controlled result, correlate it to the correct Relay session, apply policy, and assign the configured Discord role.

The mock must not be described as reproducing ID.me's identity-proofing process.

## Intended production sequence

1. User initiates verification from the community workflow.
2. Relay creates a short-lived correlation/session record.
3. Relay redirects the user into the approved identity-provider authorization/verification flow.
4. Provider redirects the user to a pre-registered Relay callback.
5. Relay validates callback state and exchanges/validates provider artifacts according to the approved integration.
6. Relay obtains only the attributes necessary to evaluate the configured policy.
7. Relay determines whether the result satisfies that policy.
8. Relay maps the result to a preconfigured Discord guild/server and role.
9. Relay requests the role assignment through the Discord API.
10. Relay records a minimal audit result and invalidates the one-time verification session.
11. User receives a success or failure result without unnecessary identity data being exposed.

## Trust boundaries

### Browser / user
Treat all browser-supplied identifiers and parameters as untrusted until validated. The browser must not be authoritative for verification outcome, target role, target server, identity attributes, or completion state.

### Identity provider
Only the approved provider integration may be authoritative for the verification result. Production code should validate the provider response according to the approved OAuth/OIDC configuration.

### Relay
Relay is trusted to correlate transactions, apply configured mapping/policy, protect secrets, and invoke Discord. It should minimize access to identity data.

### Discord
Discord is authoritative for Discord user identity, server membership, role existence, role hierarchy, permission enforcement, and final role-assignment state.

## Minimum expected persisted concepts

### Verification transaction
- random transaction/correlation identifier
- expected Discord user identifier
- expected guild/server identifier
- verification policy identifier
- creation and expiration timestamps
- completion state
- sanitized outcome

### Audit event
- transaction/correlation identifier
- timestamp
- high-level verification outcome
- high-level Discord action outcome
- sanitized error category, if any

Do not persist provider payloads merely because they are available.

## Configuration boundaries

Organization-specific values should remain configuration: Discord application ID, guild/server ID, target role ID, verification policy/scope, provider environment, redirect URI, branding/presentation values, and retention settings.

## ID.me environment boundary

Sandbox and production must be treated as separate environments. Environment-specific configuration can include endpoints/discovery configuration, client credentials, registered redirect URI, and policy/scope. Production must use the configuration assigned to the production application.

## Discord role boundary

The application should not receive broader permissions than required. The managed role must be explicitly configured; Relay must not accept an arbitrary target role from a browser request. The application role must be high enough in the hierarchy to manage the configured target role without granting unnecessary administrator access.

## Failure behavior

Expected cases include expired sessions, mismatched state, provider cancellation/denial/error, failed policy, token-validation failure, Discord user not present, missing role, hierarchy failure, missing permission, Discord API failure/rate limiting, and duplicate callback/replay.

## Open production decisions

- verification validity duration
- re-verification policy
- role revocation behavior
- audit retention
- operator access
- hosting platform
- database/storage choice
- monitoring and alerting
- disaster recovery
