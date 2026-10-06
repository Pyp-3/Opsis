import { useState } from 'react';
import { readModelProfiles } from './model-profiles';
import { accountSetting } from './account-settings';
import { DEFAULT_BOARD_MODELS, BOARD_PROVIDERS, PROVIDER_LABELS } from '@opsis/schema';
import type { FormEvent, RefObject } from 'react';
import {
  ArrowUp,
  ChevronDown,
  Gauge,
  LoaderCircle,
  SlidersHorizontal,
  Square,
  X,
} from 'lucide-react';
import type { BoardAgent, BoardAttachment, BoardDocument } from '@opsis/schema';
import { ModelControls } from './ModelControls';
import { AgentLogo } from './AgentLogo';
import { AttachButton, AttachmentChips } from './Attachments';
import { saveModelPreferences, type ModelPreferences } from './model-settings';
import { untilLabel, type AgentCaps, type AgentStatus } from './provider-usage';

type ProviderControls = {
  enabled: boolean;
  status: AgentStatus | null;
  caps: AgentCaps;
  setEnabled: (enabled: boolean) => void;
  setCaps: (caps: AgentCaps) => void;
};

type BoardComposerProps = {
  board: BoardDocument | null;
  agent: BoardAgent;
  busy: boolean;
  attachments: BoardAttachment[];
  prompt: string;
  promptInput: RefObject<HTMLTextAreaElement>;
  selected: string | null;
  settingsOpen: boolean;
  modelPreferences: ModelPreferences;
  modelLabel: string;
  localTerminalExample: boolean;
  connectionError: string;
  status: { available: boolean; detail: string } | undefined;
  provider: ProviderControls;
  generation: { busy: boolean; cancel: () => void };
  generate: (event?: FormEvent) => Promise<void>;
  setAttachments: (attachments: BoardAttachment[]) => void;
  setPrompt: (prompt: string) => void;
  setError: (error: string) => void;
  setModelPreferences: (preferences: ModelPreferences) => void;
  setAgent: (agent: BoardAgent) => void;
  setSettingsOpen: (open: boolean) => void;
  setSelected: (id: string | null) => void;
  /** Tucks the composer into a small button; omitted while it must stay open. */
  onMinimize?: () => void;
};

export function BoardComposer({
  board,
  agent,
  busy,
  attachments,
  prompt,
  promptInput,
  selected,
  settingsOpen,
  modelPreferences,
  modelLabel,
  localTerminalExample,
  connectionError,
  status,
  provider,
  generation,
  generate,
  setAttachments,
  setPrompt,
  setError,
  setModelPreferences,
  setAgent,
  setSettingsOpen,
  setSelected,
  onMinimize,
}: BoardComposerProps) {
  const [suggestions, setSuggestions] = useState(false);
  const [task, setTask] = useState('overview');
  const profiles = readModelProfiles();
  const fallback = agent === 'demo' ? undefined : accountSetting('model-fallbacks')?.[agent];
  const suggestion =
    agent === 'demo'
      ? null
      : task === 'branches' && (agent === 'claude' || agent === 'codex')
        ? {
            model: agent === 'claude' ? 'sonnet' : DEFAULT_BOARD_MODELS.codex.model,
            effort: 'medium' as const,
          }
        : DEFAULT_BOARD_MODELS[agent];
  const applySettings = (value: ModelPreferences) => {
    setModelPreferences(value);
    saveModelPreferences(value).catch(() =>
      setError('Settings apply now but could not be saved to your account.'),
    );
  };
  const providerBlocked = agent !== 'demo' && provider.enabled && !!provider.status?.blocked;
  const providerTracked = agent !== 'demo' && provider.enabled && !!provider.status?.tracked;
  return (
    <form
      className={`composer ${busy ? 'is-busy' : ''}`}
      onSubmit={(event) => void generate(event)}
    >
      {agent !== 'demo' && (
        <AttachmentChips attachments={attachments} disabled={busy} onChange={setAttachments} />
      )}
      <div className="composer-input">
        <label className="sr-only" htmlFor="visual-prompt">
          What would you like to understand?
        </label>
        <textarea
          ref={promptInput}
          id="visual-prompt"
          value={prompt}
          maxLength={4000}
          rows={2}
          placeholder={
            board
              ? 'Ask a follow-up, or change something on the canvas…'
              : 'What would you like to understand?'
          }
          disabled={busy}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void generate();
            }
          }}
        />
        {agent !== 'demo' && (
          <AttachButton
            attachments={attachments}
            disabled={busy}
            onChange={setAttachments}
            onError={setError}
          />
        )}
        {generation.busy ? (
          <button
            key="cancel-generation"
            className="send-prompt"
            type="button"
            aria-label="Cancel generation"
            onClick={(event) => {
              event.preventDefault();
              generation.cancel();
            }}
          >
            <Square size={14} fill="currentColor" />
          </button>
        ) : (
          <button
            key="submit-generation"
            className="send-prompt"
            type="submit"
            aria-label="Generate diagram"
            disabled={
              busy ||
              !prompt.trim() ||
              (!localTerminalExample &&
                agent !== 'demo' &&
                status?.available === false &&
                !modelPreferences[agent].executablePath) ||
              (!localTerminalExample && providerBlocked)
            }
          >
            <ArrowUp size={19} />
          </button>
        )}
      </div>
      {agent !== 'demo' && (
        <p className="request-identity">
          Next request: {agent} · {modelPreferences[agent].model || 'Choose a model'} ·{' '}
          {agent === 'claude' && modelPreferences[agent].model.includes('haiku')
            ? 'built-in reasoning'
            : modelPreferences[agent].effort}
        </p>
      )}
      {agent !== 'demo' && settingsOpen && (
        <div className="model-settings" id="model-settings">
          {fallback && (
            <div className="model-suggestion">
              <p>
                Fallback: {fallback.agent} · <code>{fallback.settings.model}</code> ·{' '}
                {fallback.settings.effort} effort. Switching changes your selected agent and its
                default settings. Submit separately when ready; no automatic retry.
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setAgent(fallback.agent);
                  setError('');
                  applySettings({ ...modelPreferences, [fallback.agent]: fallback.settings });
                }}
              >
                Switch to saved fallback
              </button>
            </div>
          )}
          <label>
            Named profile
            <select
              value=""
              disabled={busy}
              onChange={(event) => {
                const profile = profiles.find((item) => item.id === event.target.value);
                if (profile) applySettings({ ...modelPreferences, [agent]: profile.settings });
              }}
            >
              <option value="">Choose saved settings…</option>
              {profiles
                .filter((profile) => profile.agent === agent)
                .map((profile) => (
                  <option value={profile.id} key={profile.id}>
                    {profile.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={suggestions}
              onChange={(event) => setSuggestions(event.target.checked)}
            />{' '}
            Show task-based suggestions
          </label>
          {suggestions && (
            <div className="model-suggestion">
              <label>
                Task
                <select
                  aria-label="Task"
                  value={task}
                  onChange={(event) => setTask(event.target.value)}
                >
                  <option value="overview">Quick overview</option>
                  <option value="branches">Detailed branch analysis</option>
                </select>
              </label>
              <p>
                Suggested: {agent} · <code>{suggestion?.model}</code> · {suggestion?.effort} effort
              </p>
              <p>
                {task === 'overview'
                  ? 'Try the economical default with low effort.'
                  : 'Consider medium effort for checking multiple branches. This may consume more tokens; model access depends on your account.'}{' '}
                Your choice changes only when you apply this suggestion.
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  applySettings({
                    ...modelPreferences,
                    [agent]: {
                      ...modelPreferences[agent],
                      ...suggestion,
                    },
                  })
                }
              >
                Apply suggested model and effort
              </button>
            </div>
          )}
          <ModelControls
            agent={agent}
            value={modelPreferences[agent]}
            disabled={busy}
            onChange={(value) => {
              const next = { ...modelPreferences, [agent]: value };
              setModelPreferences(next);
              saveModelPreferences(next).catch(() =>
                setError(
                  'Model settings apply to this session, but could not be saved to your account.',
                ),
              );
            }}
          />
          <fieldset className="provider-mode">
            <legend>
              <Gauge size={13} /> Provider mode
            </legend>
            <label className="provider-switch">
              <input
                type="checkbox"
                checked={provider.enabled}
                onChange={(event) => provider.setEnabled(event.target.checked)}
              />
              Track this agent’s usage windows and disable it at the cap
            </label>
            {provider.enabled && (
              <>
                <div className="provider-caps">
                  <label>
                    5-hour cap
                    <input
                      type="number"
                      min={0}
                      max={100000}
                      value={provider.caps.fiveHour || 0}
                      onChange={(event) =>
                        provider.setCaps({
                          ...provider.caps,
                          fiveHour: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  <label>
                    Weekly cap
                    <input
                      type="number"
                      min={0}
                      max={100000}
                      value={provider.caps.weekly || 0}
                      onChange={(event) =>
                        provider.setCaps({ ...provider.caps, weekly: Number(event.target.value) })
                      }
                    />
                  </label>
                </div>
                <p className="provider-usage">
                  {provider.status?.cap5h
                    ? `5h: ${provider.status.used5h}/${provider.status.cap5h}`
                    : '5h: no limit'}{' '}
                  ·{' '}
                  {provider.status?.cap7d
                    ? `week: ${provider.status.used7d}/${provider.status.cap7d}`
                    : 'week: no limit'}
                  . 0 means no limit. Each agent keeps its own count on this device.
                </p>
              </>
            )}
          </fieldset>
        </div>
      )}
      <div className="composer-footer">
        <label className="agent-picker">
          <AgentLogo agent={agent} />
          <span className="sr-only">Agent</span>
          <select
            aria-label="Agent"
            value={agent}
            disabled={busy}
            onChange={(event) => setAgent(event.target.value as BoardAgent)}
          >
            {BOARD_PROVIDERS.map((id) => (
              <option key={id} value={id}>
                {PROVIDER_LABELS[id]}
              </option>
            ))}
            <option value="demo">Demo · built-in examples</option>
          </select>
        </label>
        {agent !== 'demo' && (
          <button
            type="button"
            className="model-toggle"
            aria-expanded={settingsOpen}
            aria-controls="model-settings"
            aria-label={`Model settings: ${modelLabel}`}
            onClick={() => setSettingsOpen(!settingsOpen)}
          >
            <SlidersHorizontal size={13} />
            <span className="model-toggle-label">Model: {modelLabel}</span>
            <ChevronDown className="chevron" size={13} />
          </button>
        )}
        <span className="agent-status" role="status">
          {generation.busy ? (
            <>
              <LoaderCircle className="spin" size={13} /> Working
            </>
          ) : agent === 'demo' ? (
            'Sample content · no agent calls'
          ) : localTerminalExample ? (
            'Local terminal example · no agent call'
          ) : (
            connectionError ||
            (modelPreferences[agent].connection === 'api'
              ? 'Official API · uses this instance’s key'
              : ['kimi', 'grok', 'antigravity'].includes(agent)
                ? 'Installed CLI · check configuration in Settings'
                : status?.detail || 'Checking local agent…')
          )}
        </span>
        {providerTracked && provider.status && (
          <span
            className={`provider-pill ${providerBlocked ? 'is-blocked' : ''}`}
            role="status"
            title="Provider mode usage"
          >
            <Gauge size={12} />
            {providerBlocked
              ? `${provider.status.reason} · resets ${untilLabel(provider.status.resetsAt)}`
              : provider.status.cap5h
                ? `${provider.status.used5h}/${provider.status.cap5h} this 5h`
                : `${provider.status.used7d}/${provider.status.cap7d} this week`}
          </span>
        )}
        {selected && (
          <button
            type="button"
            className="selection-pill"
            aria-label="Clear selected step"
            onClick={() => setSelected(null)}
          >
            1 step selected <X size={12} />
          </button>
        )}
        {onMinimize && (
          <button
            type="button"
            className="composer-minimize"
            aria-label="Minimize composer"
            title="Tuck the composer away"
            onClick={onMinimize}
          >
            <ChevronDown size={15} />
          </button>
        )}
      </div>
    </form>
  );
}
