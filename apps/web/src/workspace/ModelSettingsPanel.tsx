import { useState } from 'react';
import {
  BoardModelSettingsSchema,
  modelSettingsProblem,
  type BoardModelSettings,
} from '@opsis/schema';
import { ModelControls } from './ModelControls';
import { type ModelPreferences, MODEL_SETTINGS_KEY } from './model-settings';
import { readModelProfiles, writeModelProfiles, type ModelProfile } from './model-profiles';
import { readReportedUsage, clearReportedUsage } from './reported-usage';

export function ModelSettingsPanel({
  preferences,
  onChange,
}: {
  preferences: ModelPreferences;
  onChange: (value: ModelPreferences) => void;
}) {
  const [agent, setAgent] = useState<'claude' | 'codex'>('claude');
  const [profiles, setProfiles] = useState(readModelProfiles);
  const [editing, setEditing] = useState('');
  const [name, setName] = useState('');
  const [notice, setNotice] = useState('');
  const [checking, setChecking] = useState(false);
  const [usage, setUsage] = useState(readReportedUsage);
  const value = preferences[agent];
  function set(next: BoardModelSettings) {
    onChange({ ...preferences, [agent]: next });
    setNotice('');
    if (!BoardModelSettingsSchema.safeParse(next).success) {
      setNotice('Complete valid settings before saving.');
      return;
    }
    try {
      localStorage.setItem(MODEL_SETTINGS_KEY, JSON.stringify({ ...preferences, [agent]: next }));
    } catch {
      setNotice('Settings apply now but could not be saved on this device.');
    }
  }
  function saveProfiles(next: ModelProfile[]) {
    try {
      writeModelProfiles(next);
      setProfiles(next);
      setNotice('Profiles saved on this device.');
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
        Defaults and named profiles are saved on this device. Credentials stay in your local CLI
        login.
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
            <option value="claude">Claude</option>
            <option value="codex">Codex</option>
          </select>
        </label>
        <label>
          Executable path
          <input
            value={value.executablePath ?? ''}
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
        <p>
          Output-token cap: unavailable in these CLI integrations. Requests stop after three
          minutes, with at most one invalid-output repair on the same model. A repair is a second
          attempt; a Claude budget applies separately to each attempt and is enforced by the CLI.
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
        <h3>Provider-reported usage</h3>
        <p>
          Last 100 requests on this device, including reported repair attempts. Missing usage means
          unavailable, not zero. Dollar figures are CLI estimates, not billed cost; subscription
          allowances and other applications are not measured here.
        </p>
        <button
          onClick={() => {
            try {
              clearReportedUsage();
              setUsage([]);
            } catch {
              setNotice('Could not clear local usage history on this device.');
            }
          }}
        >
          Clear local usage history
        </button>
        {!usage.length && <p>No usage reported yet.</p>}
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
