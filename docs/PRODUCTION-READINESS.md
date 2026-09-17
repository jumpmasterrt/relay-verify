# Production Readiness Checklist

Relay Verify is currently a proof of concept. This checklist should be closed before describing a deployment as production-ready.

## Provider integration

- [ ] Production provider relationship/onboarding complete
- [ ] Production application registered
- [ ] Production client ID configured outside source control
- [ ] Production client secret configured outside source control
- [ ] Production redirect URI registered and exact
- [ ] Correct production authorization/token/attribute endpoints configured
- [ ] OIDC discovery/well-known configuration correct, if used
- [ ] Requested scope/policy approved
- [ ] Provider certificate/encryption requirements satisfied, if applicable
- [ ] Provider production-readiness requirements completed

## OAuth / OIDC security

- [ ] Authorization-code flow reviewed
- [ ] `state` strong, validated, and expiring
- [ ] PKCE implemented where applicable
- [ ] Nonce handling implemented where applicable
- [ ] Issuer/audience/signature/expiration validated
- [ ] Replay/duplicate callback behavior tested
- [ ] Provider errors/cancellations tested
- [ ] Tokens excluded from normal logs

## Discord

- [ ] Dedicated application/bot configured
- [ ] Bot token stored outside source control
- [ ] Target guild/server configured server-side
- [ ] Target role configured server-side
- [ ] Target role cannot be supplied arbitrarily by a client
- [ ] Bot has only required permissions
- [ ] Bot does not require `Administrator`
- [ ] Bot role is above target role
- [ ] Missing-member/role/permission/hierarchy failures tested
- [ ] Discord API failure/rate-limit behavior tested

## Data and privacy

- [ ] Required identity attributes documented
- [ ] Unnecessary attributes removed
- [ ] Identity documents never stored by Relay
- [ ] Full provider payload retention avoided or justified
- [ ] Audit schema documented
- [ ] Retention/deletion behavior documented
- [ ] Logs reviewed for PII leakage
- [ ] Backups reviewed for PII/secrets exposure

## Application security

- [ ] Production session secret generated securely
- [ ] Secure cookie settings enabled
- [ ] Session and transaction timeout defined
- [ ] Completed transactions cannot be reused
- [ ] Input validation and error handling reviewed
- [ ] Security headers configured
- [ ] Rate limiting / abuse controls configured
- [ ] Dependency lockfiles committed
- [ ] Dependency vulnerability monitoring enabled
- [ ] Supported runtime versions documented

## Infrastructure

- [ ] Hosting platform selected
- [ ] HTTPS enforced
- [ ] TLS certificate lifecycle defined
- [ ] Storage selected with least-privilege permissions
- [ ] Secrets management selected
- [ ] Logging/monitoring/alerting configured
- [ ] Backup and restore defined/tested
- [ ] Deployment and rollback documented

## Organization policy

- [ ] Verification policy → Discord role mapping approved
- [ ] Verification validity period defined
- [ ] Re-verification policy defined
- [ ] Role revocation policy defined
- [ ] Eligibility-change behavior defined
- [ ] Audit-retention period approved
- [ ] Operator/auditor access defined
- [ ] End-user support path defined

## Documentation and ownership

- [ ] Deployment instructions complete
- [ ] Configuration reference complete
- [ ] Operations/runbook complete
- [ ] Incident-response contact defined
- [ ] Vulnerability-reporting process defined
- [ ] Maintenance owner defined
- [ ] License selected before public release
- [ ] Third-party notices/attribution reviewed
- [ ] README status updated when appropriate

## Release gate

A live provider integration should not be represented as production-ready until provider integration, application security, Discord authorization, data/privacy, infrastructure, and organizational-policy review have been accepted by the responsible parties.
