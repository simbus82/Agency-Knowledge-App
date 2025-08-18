# Security Policy

## Supported Versions
Pre-1.0 (current 0.9.x) receives security fixes on latest minor only.

## Reporting a Vulnerability
Email: security@agency.agency or open a private security advisory on GitHub.
Provide:
- Description & impact
- Affected endpoints / files
- Reproduction steps / PoC
- Suggested remediation (if any)

## Handling Process
1. Acknowledge within 72h
2. Triage severity (CVSS approximation)
3. Patch in private branch
4. Release patched version & disclose

## Secrets Management
- Never commit real API keys
- Use `.env` local only
- Rotate Claude / OAuth credentials quarterly

## Hardening Roadmap
- Add rate limiting
- CSP strict mode
- Central audit trail
- Dependency audit CI (npm audit)

