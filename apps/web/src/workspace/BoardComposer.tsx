import type { FormEvent, RefObject } from 'react';
import { ArrowUp, ChevronDown, LoaderCircle, SlidersHorizontal, Square, X } from 'lucide-react';
import type { BoardAgent, BoardAttachment, BoardDocument } from '@opsis/schema';
import { ModelControls } from './ModelControls';
import { AgentLogo } from './AgentLogo';
import { AttachButton, AttachmentChips } from './Attachments';
import { MODEL_SETTINGS_KEY, type ModelPreferences } from './model-settings';

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
  generation: { busy: boolean; cancel: () => void };
  generate: (event?: FormEvent) => Promise<void>;
  setAttachments: (attachments: BoardAttachment[]) => void;
  setPrompt: (prompt: string) => void;
  setError: (error: string) => void;
  setModelPreferences: (preferences: ModelPreferences) => void;
  setAgent: (agent: BoardAgent) => void;
  setSettingsOpen: (open: boolean) => void;
  setSelected: (id: string | null) => void;
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
  generation,
  generate,
  setAttachments,
  setPrompt,
  setError,
  setModelPreferences,
  setAgent,
  setSettingsOpen,
  setSelected,
}: BoardComposerProps) {
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
              (!localTerminalExample && agent !== 'demo' && status?.available === false)
            }
          >
            <ArrowUp size={19} />
          </button>
        )}
      </div>
      {agent !== 'demo' && settingsOpen && (
        <div className="model-settings" id="model-settings">
          <ModelControls
            agent={agent}
            value={modelPreferences[agent]}
            disabled={busy}
            onChange={(value) => {
              const next = { ...modelPreferences, [agent]: value };
              setModelPreferences(next);
              try {
                localStorage.setItem(MODEL_SETTINGS_KEY, JSON.stringify(next));
              } catch {
                setError(
                  'Model settings apply to this session, but could not be saved on this device.',
                );
              }
            }}
          />
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
            <option value="claude">Claude</option>
            <option value="codex">Codex</option>
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
            connectionError || status?.detail || 'Checking local agent…'
          )}
        </span>
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
      </div>
    </form>
  );
}
