# Opsis documentation

Opsis is a local-first canvas for exploring processes through connected icons,
explanations, and narrated playback. Run it on your computer and try the built-in
examples before connecting an agent.

## Using Opsis

- [Getting started](GETTING-STARTED.md): prerequisites, installation, your first board,
  release downloads, and startup troubleshooting.
- [User guide](USER-GUIDE.md): editing, templates, saving, sharing, playback, and exports.
- [Canvas and generation features](FEATURES.md): diagrams, playback, uploads and proposal review.
- [Agent and model settings](AGENT-CONFIGURATION.md): CLI setup,
  model choice, effort, and environment configuration.
- [Release downloads](https://github.com/Pyp-3/Opsis/releases): Linux desktop builds
  and developer bundles, with version metadata and SHA-256 checksums.

## Developing and integrating

- [Contributing](../CONTRIBUTING.md): development workflow, required checks, issues,
  and pull requests.
- [API reference](../apps/api/README.md): routes, ownership, persistence, and configuration.
- [MCP integration](../apps/mcp/README.md): agent keys, client setup, and available tools.
- [Process engine](PROCESS-ENGINE.md): synthetic calculations, contracts, limits, and builds.
- [Architecture and refactoring](REFACTORING.md): module boundaries and preserved behavior.
- [Development instructions](../AGENTS.md): the authoritative guide for coding agents.
- [Release workflow](RELEASES.md): versioning, packaging, and CI.

## Project history

[GOALS.md](../GOALS.md) records product direction. The dated [stress audit](QA-STRESS.md),
[decision records](DECISIONS.md), [2D implementation notes](OPSIS-2D.md),
[pedagogy notes](PEDAGOGY.md), and files under `comms/` retain historical context.
They are not substitutes for current code, tests, or the user guides above.

Found a documentation problem? [Open an issue](https://github.com/Pyp-3/Opsis/issues/new)
with the page, the unclear or incorrect section, and what you expected to find.

## Updating the GitHub Wiki

The wiki's Home, Getting started, User guide, and Contributing pages are generated
from these repository guides. Edit the source Markdown here, run `pnpm docs:wiki`,
and review the six generated files under `output/wiki/` (four pages, sidebar, footer).
Relative links are converted to wiki pages or the corresponding repository reference.
Commit and push the source changes, then copy the generated Markdown into a clone
of `https://github.com/Pyp-3/Opsis.wiki.git`, review its diff, commit, and push its
default branch. Preserve any wiki pages not managed by the generator.

GitHub requires an initial page to be saved through the wiki's web interface before
the wiki repository can be cloned. The main repository's CI/CD release workflow
does not publish wiki changes automatically.

- [Desktop app](DESKTOP.md): Go/Wails builds, Hyprland, database import, native MCP, and migration coverage.
