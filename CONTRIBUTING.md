# Contributing

## Branch strategy

PRs must target **`dev`**, not `main`. Direct pushes to `main` and `staging` are not accepted.

Promotion path: `dev` → `staging` → `main`

## Getting started

See [README.md](README.md) for setup instructions (Docker or manual).

## Pull requests

- Keep PRs focused — one feature or fix per PR
- Include a clear description of what changed and why
- All CI checks must pass before merge (TypeScript type check + npm audit)
- Breaking changes must be noted in the PR description

## Reporting security issues

**Do not open a public issue for security vulnerabilities.**

See [SECURITY.md](SECURITY.md) for the full disclosure policy and contact details.

## CI and cache integrity

Workflows run with minimum required permissions (`contents: read`). All third-party actions are pinned to immutable commit SHAs to prevent supply chain attacks. Fork PRs cannot write to the GHA cache.

If you spot a workflow permission issue or a dependency that should be pinned, open an issue.
