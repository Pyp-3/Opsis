# Agent configuration

## Agents and model configuration

Install and sign in to your preferred agent CLI separately. Opsis uses that CLI's existing local login; it does **not** read, copy, or require you to paste subscription credential files.

In the prompt panel at the bottom of the canvas:

1. Choose **Agent**: Claude, Codex, or Demo.
2. Open **Model** in the prompt panel: choose a versioned preset, a CLI alias, or **Custom model ID…**. The settings show the exact ID sent to the agent.
3. Choose **Effort**, if supported by the model.
4. Submit the prompt. Reading details, editing the graph, and changing settings do not generate model calls.

Claude initially selects Haiku; Codex initially selects GPT-6 Luna with low effort. These are application presets, not a guarantee of account availability. Haiku's effort selector is disabled. Unsupported models or effort levels return an error rather than silently switching to an expensive model. Settings are remembered separately for each agent.

Claude presets include Haiku 4.5, Sonnet 5.5, Opus 5.5, Fable 5.1, and earlier Sonnet/Opus 4.6. The `haiku`, `sonnet`, and `opus` options are explicitly marked as CLI aliases: their resolved version depends on your CLI configuration and provider. Choose a versioned ID for a specific generation. Codex presets include GPT-6 Luna, GPT-6.1 Sol, GPT-6 Sol, and GPT-6 Astra. These lists follow the [Claude model documentation](https://platform.claude.com/docs/en/models/overview) and [OpenAI model documentation](https://learn.chatgpt.com/docs/models); selecting a preset does not grant account access.

CLI readiness checks installation/version, not subscription entitlement. An actual generation is needed to verify model access. Effort is **not** a token or spending cap; usage remains subject to your provider's subscription and limits. Open **Settings → Agents and models** for executable paths, named profiles, request character limits, optional Claude budgets per attempt and provider-reported usage history. Missing usage remains unavailable rather than zero; reported costs are not invoices. Output-token caps are not supported by these CLI integrations. See [model and canvas controls](P1-CONTROLS.md) for persistence, limits and consent-based suggestions.

Per-agent preferences, profiles, provider caps and usage history belong to your account: they are stored in the Opsis database, follow you to other browsers using the same Opsis server, and are included in full-database backups. New provider integrations and Windows/macOS desktop packaging remain separate roadmap work.

### Configuration

| Variable           | Purpose                                   | Default                      |
| ------------------ | ----------------------------------------- | ---------------------------- |
| `OPSIS_CLAUDE_BIN` | Claude CLI executable override            | Auto-discovered              |
| `OPSIS_CODEX_BIN`  | Codex CLI executable override             | Auto-discovered              |
| `HOST`             | API listen address                        | `127.0.0.1`                  |
| `PORT`             | API port                                  | `8000`                       |
| `OPSIS_DB_PATH`    | SQLite database for v2 and legacy boards  | `apps/api/data/opsis.sqlite` |
| `OPSIS_SPEECH`     | `off` disables the API's natural narrator | on                           |
| `OPSIS_MODEL_DIR`  | Where the narrator's speech model is kept | `apps/api/data/models`       |

Use absolute executable paths when overriding the CLI locations. Executables and versions are validated by the harness. Model and effort settings come from the canvas request; the retired pipeline’s `OPSIS_LLM_*` configuration is no longer used. See [API documentation](../apps/api/README.md) for current settings.

CLI discovery searches the API process's `PATH`, then common user/system installation locations on Windows, Linux, and macOS (including Apple Silicon Homebrew). Windows npm installs are resolved to their package's native executable or JavaScript entry point; `.cmd`/`.ps1` npm overrides are supported without invoking a shell. Custom shell wrappers are unsupported. Restart the API after installing a CLI or changing its `PATH`. An explicit override takes precedence and fails if invalid instead of silently selecting another installation. Readiness checks do not verify login or model entitlement.
