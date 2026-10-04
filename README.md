# Opsis

[![CI](https://github.com/Pyp-3/Opsis/actions/workflows/ci.yml/badge.svg)](https://github.com/Pyp-3/Opsis/actions/workflows/ci.yml)

**See what you mean.** Turn questions into editable diagrams, explore each concept, and play a process step by step.

[Download](https://github.com/Pyp-3/Opsis/releases) · [Getting started](docs/GETTING-STARTED.md) · [Documentation](docs/README.md) · [Roadmap](GOALS.md)

## Demonstration

Try it without an agent subscription or model calls:

1. Create a local account and open **An email’s journey** from Home.
2. Select an icon to explore it. Drag concepts to rearrange the flow.
3. Choose **Play the process**, or export your diagram to share it.

![Opsis displaying the built-in email journey as an editable diagram](docs/images/demo-canvas.png)

_Follow the connections, then select a concept for its explanation._

![The email journey with a concept selected and its explanation open](docs/images/demo-details.png)

## What you can do

- Generate and refine diagrams with your local Claude or Codex CLI; review proposed changes before applying them.
- Edit connections, collapse groups, attach notes and sources, and reuse boards as templates.
- Save locally with SQLite, undo history, revisions and recovery; invite named accounts on the same server to edit.
- Import text or existing diagrams; export editable JSON, images or Markdown.
- Let your own agents work on canvases through [MCP](apps/mcp/README.md).

## Run Opsis

**Linux desktop:** download the desktop tarball from [Releases](https://github.com/Pyp-3/Opsis/releases), extract it, and run `opsis`. GTK 3 and WebKitGTK 4.1 are required. See the [desktop guide](docs/DESKTOP.md) for builds and Hyprland setup. Windows/macOS desktop packages are still planned.

**Browser development:** install Node.js 20.19+, pnpm 10.34.5, Rust via rustup and a native compiler, then:

```sh
git clone https://github.com/Pyp-3/Opsis.git
cd Opsis
./opsis dev
```

Open **http://localhost:3000**. For native Windows and troubleshooting, see [Getting started](docs/GETTING-STARTED.md).

Your boards stay on your machine. Agent generation sends your prompt and supplied context through the selected provider and may consume its quota. Keep the server on loopback; public hosting is not supported.

[User guide](docs/USER-GUIDE.md) · [Agent settings](docs/AGENT-CONFIGURATION.md) · [Contributing](CONTRIBUTING.md) · [Release notes and packaging](docs/RELEASES.md)
