# Contributing to Opsis

Start with the [setup guide](docs/GETTING-STARTED.md) and read [AGENTS.md](AGENTS.md)
before changing code. It defines module ownership, contracts, persistence rules,
and validation requirements. [The refactoring record](docs/REFACTORING.md) explains
the current architecture and retired behavior.

## Issues and proposals

Search [existing issues](https://github.com/Pyp-3/Opsis/issues) first. For a bug,
include a minimal reproduction, expected and actual behavior, OS/browser, and commit
or release version. Prefer a built-in demo so maintainers can reproduce the issue
without provider accounts or paid model calls.

For a feature request, describe the user problem, an example workflow, and the
result you want. For documentation, name the page and section that needs attention.
Do not include credentials, private board contents, databases, or unredacted traces.

## Development workflow

1. Fork the repository if you do not have write access, then create a focused branch.
2. Install the pinned dependencies with `pnpm install --frozen-lockfile`.
3. Make the change and add regression coverage for confirmed bugs or risky behavior.
4. Format changed files with `pnpm exec prettier --write <paths>`.
5. Run the checks below, review your diff, and open a pull request against `main`.

Keep behavior fixes and structural refactors separate where practical. Preserve
existing databases, account ownership, revision handling, undo history, and explicit
agent proposal review. Prefer shared board rules from `packages/schema` over copies
in individual applications.

## Required checks

```sh
pnpm lint
pnpm typecheck
pnpm engine:check
pnpm engine:test
pnpm release:test
pnpm test:qa
```

Install the browser for local QA with `pnpm exec playwright install chromium`.
Linux may also need Playwright's system dependencies. Packaging tests require Git,
`zip`, and `unzip`. Browser tests start isolated servers on ports 3100 and 8100 with
an in-memory database and API speech disabled. Use demo/fake agents; live-provider
smoke scripts require explicit authorization.

Report the commands you actually ran, including failures or skipped checks. Do not
weaken assertions to get a green run. When UI text changes, update its tests and
documentation together. Run browser accessibility checks after entrance animations
settle so they measure the displayed state.

## Pull requests and releases

Explain the user-visible problem and result, link any related issue, and state how
you verified the change. Include screenshots for visible UI changes when useful.
Do not commit dependencies, compiled output, local databases, credentials, or test
artifacts.

Pull requests run checks without publishing. Successful branch pushes in the
repository publish versioned prerelease bundles. `VERSION` tracks the base version;
the run number and commit identify each build. See the
[release workflow](README.md#automatic-build-releases) for details.
