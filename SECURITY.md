# Security Policy

Relay Verify sits between an identity provider and Discord. That makes seemingly small implementation mistakes potentially important.

## Current status

Relay Verify is currently a **proof of concept**. The mock verification flow must not be interpreted as production identity verification.

Until a production integration has completed provider onboarding, implementation review, deployment review, and security review, the project should be treated as evaluation software.

## Reporting a vulnerability

Please do **not** publish suspected security vulnerabilities in a public GitHub issue.

While the repository is private, report findings directly to the repository owner or through the private review channel used for the evaluation.

Before the repository becomes public, a durable private vulnerability-reporting mechanism should be established and documented here.

## Secrets

Never commit:

- ID.me or other provider client secrets
- Discord bot tokens
- session secrets
- signing keys
- private certificates or certificate keys
- production access tokens or refresh tokens
- database exports containing verification records
- `.env` files containing real values

Only safe placeholders belong in `.env.example`.

If a secret is committed, assume it is compromised even if the commit is later removed.

## Identity data

Relay should minimize the identity information it requests, processes, stores, and logs.

The intended design is to answer a narrow authorization question: **Did this verification satisfy the configured policy?**

Copies of identity documents should never be collected or stored by Relay.

## OAuth / OIDC

Production implementation review should include, as applicable:

- authorization-code flow handling
- exact registered redirect URI behavior
- `state` generation, storage, comparison, and expiration
- PKCE implementation when used
- issuer and audience validation
- signature and token-expiration validation
- nonce validation when applicable
- authorization-code replay protection
- secure token handling
- callback error handling
- sandbox/production endpoint separation

Implementation details must follow the provider's approved integration configuration rather than assumptions made by the proof of concept.

## Discord

The Discord application should use least privilege.

For role assignment:

- request only the permissions required for the intended behavior
- avoid `Administrator` permission
- ensure the application/bot role is above the role it is expected to assign
- prevent configuration from permitting arbitrary privileged-role assignment
- validate guild/server and role identifiers
- log authorization decisions without logging unnecessary identity data

## Sessions

Verification sessions should:

- use cryptographically strong identifiers
- be short-lived
- be bound to the expected Discord user and verification transaction
- reject expired, missing, duplicated, or mismatched state
- be invalidated after successful completion
- not expose provider tokens to the browser unless the approved architecture specifically requires it

## Logging

Logs should contain enough information to troubleshoot the transaction without becoming a second identity database.

Prefer transaction ID, timestamp, high-level outcome, Discord action result, and sanitized errors. Avoid secrets, tokens, full provider payloads, identity-document data, and unnecessary PII.

## Dependencies

Before production:

- lock dependencies where practical
- enable dependency vulnerability monitoring
- review third-party packages for maintenance and necessity
- remove unused dependencies
- document supported runtime versions
- define a patch/update process

## Production requirement

A successful proof-of-concept demonstration is **not** equivalent to production approval.

Production readiness requires completion of the items in [`docs/PRODUCTION-READINESS.md`](docs/PRODUCTION-READINESS.md).
