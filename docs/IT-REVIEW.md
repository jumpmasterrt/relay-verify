# IT Review Guide

## Purpose

This document gives technical reviewers a focused way to evaluate Relay Verify without having to infer the intended security model from the code alone.

Relay Verify is currently a **proof of concept**. Review should distinguish prototype behavior, mock-provider assumptions, and production requirements.

## 1. Scope and trust model

Confirm that the implementation:

- treats the external identity provider as authoritative for verification
- does not attempt to perform identity proofing itself
- treats Discord role assignment as a separate authorization action
- does not trust browser-provided verification outcomes
- does not allow the browser to select arbitrary Discord roles
- clearly separates mock/test behavior from provider sandbox and production behavior

## 2. OAuth / OIDC review

For production, review authorization-code handling, registered redirect URI behavior, `state`, session expiration, PKCE when applicable, nonce when applicable, issuer/audience/signature/expiration validation, replay protection, token storage, callback errors, and provider cancellation.

## 3. ID.me environment separation

Confirm sandbox assumptions or credentials cannot silently become production configuration. Review endpoints/discovery, client credentials, redirect URI, scope/policy, and any provider-required certificate/encryption configuration.

## 4. Data minimization

Determine exactly which attributes Relay needs. Confirm no identity-document copies are collected, no full provider payload is retained without justification, unnecessary PII is not logged, and retention/deletion behavior is defined.

## 5. Discord authorization

Confirm the implementation uses a Discord application/bot identity, requests only necessary permissions, does not require `Administrator`, configures guild and target role server-side, prevents arbitrary role selection, and places the app role above the target role.

## 6. Session correlation

Review how Relay binds the Discord user, Relay transaction, provider callback state, verification outcome, guild/server, and target role. Transaction identifiers should be unpredictable, expire, and become unusable after completion.

## 7. Secret management

Search the repository history and deployment configuration for provider client secrets, Discord bot tokens, session secrets, tokens, private keys, production `.env` files, and database exports. Define storage and rotation procedures.

## 8. Logging and audit

Useful audit data may include Relay transaction ID, timestamp, policy result, Discord action result, and sanitized failure category. It normally should not include tokens, secrets, full provider payloads, identity-document data, or unrelated attributes.

## 9. Application security

Review dependency versions/lockfiles, vulnerability scanning, input validation, output encoding, CSRF exposure, secure cookies, session fixation, rate limiting, abuse/replay controls, error leakage, security headers, TLS, deployment privileges, database permissions, and backup handling.

## 10. Operational review

Define supported runtime/platform, deployment, rollback, monitoring, alerting, retention, audit access, credential rotation, dependency patching, backup/recovery, and support ownership.

## 11. Policy decisions for an adopting organization

These are not purely coding decisions: verification-policy-to-role mapping, validity period, re-verification, revocation, eligibility changes, audit retention, audit access, and user support/escalation.

## Reviewer outcome categories

- **POC acceptable** — sufficient for demonstration/evaluation
- **Production blocker** — must be resolved before live identity verification
- **Hardening** — desirable security/operational improvement
- **Policy decision** — requires an adopting organization's decision
- **Provider dependency** — depends on approved provider configuration/onboarding
