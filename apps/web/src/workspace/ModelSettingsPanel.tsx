import { useState } from 'react';
import {
  BoardModelSettingsSchema,
  BOARD_PROVIDERS,
  PROVIDER_LABELS,
  type ProviderAgent,
  modelSettingsProblem,
  type BoardModelSettings,
} from '@opsis/schema';
import { ModelControls } from './ModelControls';
import { type ModelPreferences, saveModelPreferences } from './model-settings';
import { readModelProfiles, writeModelProfiles, type ModelProfile } from './model-profiles';
import { readReportedUsage, clearReportedUsage } from './reported-usage';
import { UsageByCollection } from './UsageByCollection';
import { accountSetting, saveAccountSetting } from './account-settings';

export function ModelSettingsPanel({
  preferences,
  onChange,
}: {
  preferences: ModelPreferences;
  onChange: (value: ModelPreferences) => void;
}) {
  const [agent, setAgent] = useState<ProviderAgent>('claude');
  const [profiles, setProfiles] = useState(readModelProfiles);
  const [editing, setEditing] = useState('');
  const [name, setName] = useState('');
  const [notice, setNotice] = useState('');
  const [checking, setChecking] = useState(false);
  const [usage, setUsage] = useState(readReportedUsage);
  const [fallbacks, setFallbacks] = useState(() => accountSetting('model-fallbacks') ?? {});
  const [savingFallback, setSavingFallback] = useState(false);
  const fallback = fallbacks[agent];
  async function saveFallback(profile?: ModelProfile) {
    const next = { ...fallbacks };
    if (profile) next[agent] = structuredClone(profile);
    else delete next[agent];
    setSavingFallback(true);
    setFallbacks(next);
    try {
      await saveAccountSetting('model-fallbacks', next);
      setNotice(
        profile
          ? 'Fallback saved to your account. Switch explicitly on the canvas.'
          : 'Fallback removed.',
      );
    } catch {
      setNotice('Fallback applies now but could not be saved to your account.');
    } finally {
      setSavingFallback(false);
    }
  }
  const value = preferences[agent];
  function set(next: BoardModelSettings) {
    onChange({ ...preferences, [agent]: next });
    setNotice('');
    if (!BoardModelSettingsSchema.safeParse(next).success) {
      setNotice('Complete valid settings before saving.');
      return;
    }
    saveModelPreferences({ ...preferences, [agent]: next }).catch(() =>
      setNotice('Settings apply now but could not be saved to your account.'),
    );
  }
  async function saveProfiles(next: ModelProfile[]) {
    try {
      await writeModelProfiles(next);
      setProfiles(next);
      setNotice('Profiles saved to your account.');
    } catch {
      setNotice('Could not save profiles. Use a name and valid settings; maximum 30 profiles.');
    }
  }
  async function check() {
    setChecking(true);
    setNotice('Checking executable and version…');
    try {
      const response = await fetch('/v1/boards/check-agent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agent, settings: value }),
      });
      const body = (await response.json()) as { message?: string };
      setNotice(body.message ?? 'Could not check this configuration.');
    } catch {
      setNotice('Could not reach Opsis. Check that the application is running.');
    } finally {
      setChecking(false);
    }
  }
  return (
    <section className="agent-settings" aria-label="Agents and models">
      <h2>Agents and models</h2>
      <p>
        Defaults and named profiles are saved to your account. API credentials belong to this Opsis
        instance; CLI connections use its local login.
      </p>
      <div className="settings-card">
        <label>
          Agent
          <select
            aria-label="Agent"
            value={agent}
            onChange={(event) => {
              setAgent(event.target.value as typeof agent);
              setEditing('');
              setName('');
              setNotice('');
            }}
          >
            {BOARD_PROVIDERS.map((id) => (
              <option key={id} value={id}>
                {PROVIDER_LABELS[id]}
              </option>
            ))}
          </select>
        </label>
        {agent !== 'claude' && agent !== 'codex' && (
          <label>
            Connection
            <select
              value={value.connection ?? 'cli'}
              onChange={(event) => {
                const rest = { ...value };
                delete rest.maxOutputTokens;
                set({ ...rest, connection: event.target.value as 'cli' | 'api', effort: 'low' });
              }}
            >
              <option value="api">Official API · instance key</option>
              <option value="cli">Installed CLI · local login</option>
            </select>
          </label>
        )}
        <label>
          Executable path
          <input
            value={value.executablePath ?? ''}
            disabled={value.connection === 'api'}
            maxLength={1024}
            placeholder="Automatic discovery"
            onChange={(event) => set({ ...value, executablePath: event.target.value })}
          />
        </label>
        <small>
          Absolute path on the machine running Opsis. Leave blank to use PATH or the host’s
          configured override. No shell arguments.
        </small>
        <ModelControls agent={agent} value={value} disabled={checking} onChange={set} />
        {value.connection !== 'api' && ['kimi', 'grok', 'antigravity'].includes(agent) && (
          <p>
            Use a model ID from your installed CLI’s catalogue. Kimi 1.52 requires no installed
            plugins. Grok 1.0.46 requires its default configuration and accepts at most 24,000
            characters including Opsis instructions and schema. Antigravity 1.3 uses isolated
            settings and the operating system’s saved login; choose an explicit CLI slug such as
            gemini-3.8-flash-medium. These CLI connections accept text and extracted PDF text; use
            the API for images.
          </p>
        )}
        <label>
          Request character limit
          <input
            type="number"
            min={1000}
            max={768000}
            step={1000}
            value={value.maxRequestCharacters ?? 768000}
            onChange={(event) =>
              set({ ...value, maxRequestCharacters: Number(event.target.value) })
            }
          />
        </label>
        <small>
          Includes instructions, board JSON, extracted text and repair text. Uploaded binary files
          have separate size limits. This is not a token limit.
        </small>
        {agent === 'claude' && (
          <label>
            Dollar budget per attempt (optional)
            <input
              type="number"
              min={0.01}
              max={100}
              step={0.01}
              value={value.maxBudgetUSD ?? ''}
              onChange={(event) => {
                const next = { ...value };
                if (event.target.value) next.maxBudgetUSD = Number(event.target.value);
                else delete next.maxBudgetUSD;
                set(next);
              }}
            />
          </label>
        )}
        {value.connection === 'api' && agent !== 'antigravity' && (
          <label>
            Output-token cap per attempt (optional)
            <input
              type="number"
              min={256}
              max={64000}
              step={256}
              value={value.maxOutputTokens ?? ''}
              onChange={(event) => {
                const next = { ...value };
                if (event.target.value) next.maxOutputTokens = Number(event.target.value);
                else delete next.maxOutputTokens;
                set(next);
              }}
            />
          </label>
        )}
        <p>
          CLI connections and the managed Antigravity API do not expose an output-token cap.
          Requests stop after three minutes, with at most one invalid-output repair on the same
          model. A repair is a second attempt; a Claude budget applies separately to each attempt
          and is enforced by the CLI.
        </p>
        <button
          type="button"
          disabled={
            checking ||
            !BoardModelSettingsSchema.safeParse(value).success ||
            !!modelSettingsProblem(agent, value)
          }
          onClick={() => void check()}
        >
          Check configuration (no model call)
        </button>
        <p role="status">{notice}</p>
      </div>
      <div className="settings-card">
        <h3>Named profiles</h3>
        <label>
          Profile name
          <input value={name} maxLength={60} onChange={(event) => setName(event.target.value)} />
        </label>
        <button
          type="button"
          disabled={
            !name.trim() ||
            !BoardModelSettingsSchema.safeParse(value).success ||
            !!modelSettingsProblem(agent, value)
          }
          onClick={() => {
            saveProfiles([
              ...profiles.filter((profile) => profile.id !== editing),
              { id: editing || crypto.randomUUID(), name: name.trim(), agent, settings: value },
            ]);
            setEditing('');
            setName('');
          }}
        >
          {editing ? 'Save profile changes' : 'Add profile'}
        </button>
        {profiles.map((profile) => (
          <div className="profile-row" key={profile.id}>
            <span>
              <strong>{profile.name}</strong>
              <small>
                {profile.agent} · {profile.settings.model} · {profile.settings.effort}
              </small>
            </span>
            <button
              onClick={() => {
                setAgent(profile.agent);
                setEditing(profile.id);
                setName(profile.name);
                onChange({ ...preferences, [profile.agent]: profile.settings });
                setNotice('Editing this profile; save changes when ready.');
              }}
            >
              Edit
            </button>
            <button onClick={() => saveProfiles(profiles.filter((item) => item.id !== profile.id))}>
              Remove
            </button>
          </div>
        ))}
      </div>
      <div className="settings-card">
        <h3>Fallback for {PROVIDER_LABELS[agent]}</h3>
        <p>
          Save an alternative from a named profile. The canvas offers an explicit switch; failures
          never switch models or retry automatically. Switching makes no model call. Submit again
          yourself after checking the provider and model.
        </p>
        <label>
          Fallback profile
          <select
            aria-label="Fallback profile"
            disabled={savingFallback}
            value={fallback?.id ?? ''}
            onChange={(event) =>
              void saveFallback(profiles.find((entry) => entry.id === event.target.value))
            }
          >
            <option value="">No fallback</option>
            {fallback && !profiles.some((profile) => profile.id === fallback.id) && (
              <option value={fallback.id}>{fallback.name} · saved copy</option>
            )}
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name} · {profile.agent} · {profile.settings.model}
              </option>
            ))}
          </select>
        </label>
        {fallback && (
          <p>
            Saved alternative: {fallback.agent} · <code>{fallback.settings.model}</code> ·{' '}
            {fallback.settings.effort} effort. This is a copy of the profile; later profile edits or
            removal do not change it.
          </p>
        )}
        {fallback && profiles.some((profile) => profile.id === fallback.id) && (
          <button
            disabled={savingFallback}
            onClick={() =>
              void saveFallback(profiles.find((profile) => profile.id === fallback.id))
            }
          >
            Refresh fallback from profile
          </button>
        )}
      </div>
      <div className="settings-card">
        <h3>Provider-reported usage</h3>
        <p>
          Your account’s most recent 1,000 requests, including reported repair attempts. Missing
          usage means unavailable, not zero. Dollar figures are CLI estimates, not billed cost;
          subscription allowances and other applications are not measured here.
        </p>
        <button
          onClick={async () => {
            try {
              await clearReportedUsage();
              setUsage([]);
            } catch {
              setNotice('Could not clear usage history.');
            }
          }}
        >
          Clear usage history
        </button>
        {!usage.length && <p>No usage reported yet.</p>}
        <UsageByCollection usage={usage} />
        <div className="usage-history">
          {usage
            .slice()
            .reverse()
            .map((entry) => (
              <article key={entry.id}>
                <strong>
                  {entry.agent} · {entry.model} · {entry.effort}
                </strong>
                <small>
                  {new Date(entry.at).toLocaleString()} · {entry.purpose}
                </small>
                {!entry.attempts.length ? (
                  <p>Usage unavailable</p>
                ) : (
                  entry.attempts.map((attempt, index) => (
                    <p key={index}>
                      Attempt {index + 1}: input {attempt.inputTokens ?? 'unavailable'} · output{' '}
                      {attempt.outputTokens ?? 'unavailable'} · cache read{' '}
                      {attempt.cachedInputTokens ?? 'unavailable'} · cache write{' '}
                      {attempt.cacheWriteTokens ?? 'unavailable'} · CLI-estimated USD{' '}
                      {attempt.estimatedCostUSD ?? 'unavailable'}
                    </p>
                  ))
                )}
              </article>
            ))}
        </div>
      </div>
    </section>
  );
}
