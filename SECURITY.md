# Security Policy

## Reporting a vulnerability

**Do not open a public issue for security vulnerabilities.**

Use one of these channels:

1. **GitHub private advisory** (preferred): [Report a vulnerability](../../security/advisories/new)
2. **Email**: cl4v3r@gmail.com — include `[SECURITY]` in the subject line

Provide as much detail as possible: steps to reproduce, affected component, potential impact, and any suggested fix.

## Response timeline

| Stage | Target |
|---|---|
| Acknowledgement | 48 hours |
| Initial assessment | 5 business days |
| Fix or mitigation | Depends on severity |

Critical vulnerabilities (RCE, credential exposure) will be prioritised immediately.

## Scope

This project is a self-hosted personal tool. The primary attack surface is:

- The FastAPI backend (unauthenticated endpoints, CORS policy)
- The optional passphrase authentication (`AUTH_ENABLED`)
- CI/CD workflow permissions and supply chain

Out of scope: vulnerabilities requiring physical access, social engineering, or that only affect the user's own self-hosted instance with no external exposure.

## Disclosure policy

Once a fix is released, a GitHub Security Advisory will be published with full details. Please allow reasonable time for a fix before any public disclosure.
