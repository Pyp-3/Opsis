# Claude instructions

@AGENTS.md

The imported guide is authoritative for architecture, invariants, and development.
Keep shared project rules in `AGENTS.md`; do not rely on a Markdown link to load it.

## Required before handoff or commit

- Format changed files with `pnpm exec prettier --write <paths>`. `pnpm lint`
  includes a repository-wide formatting check; TypeScript passing is not enough.
- Run every final integration check in `AGENTS.md`, including `pnpm test:qa`,
  after the final changes. These match `.github/workflows/ci.yml`.
- When changing visible UI text, update affected browser assertions and documentation
  together. Keep the behavior assertion; do not remove it or loosen it to hide failures.
- For a CI repair, inspect the failed GitHub Actions logs and continue through later
  checks after fixing the first failure. Do not stop at a successful build or lint run.
- Report actual check results and any unresolved failures. Do not describe CI as green
  unless the relevant run passed. Local checks do not update a remote run.
- Preserve user changes and local settings. Do not commit credentials or local agent
  configuration. Follow the standing commit-and-push delivery preference in `AGENTS.md`;
  completed, validated work should trigger CI/CD unless the user asks to keep it local.
