import { ModelSettingsPanel } from './ModelSettingsPanel';
import { CostProjectionPanel } from './CostProjectionPanel';
import { ApiKeysPanel } from './ApiKeysPanel';
import type { ModelPreferences } from './model-settings';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  Layers,
  Monitor,
  Moon,
  Paintbrush,
  Pipette,
  RotateCcw,
  Sun,
  Type,
} from 'lucide-react';
import {
  ACCENT_SCHEMES,
  CUSTOM_ACCENT,
  DEFAULT_APP_THEME,
  FONT_SCHEMES,
  SURFACE_SCHEMES,
  accentOf,
  applyAppTheme,
  fontOf,
  readAppTheme,
  sameTheme,
  saveAppearance,
  surfaceOf,
  writeAppTheme,
  type AppTheme,
  type ThemeMode,
} from './app-theme';
import { HEX_COLOUR } from './theme-colour';
import { BrandMark } from './BrandMark';

const MODES: { id: ThemeMode; name: string; Icon: typeof Sun; note: string }[] = [
  { id: 'system', name: 'System', Icon: Monitor, note: 'Follow your device' },
  { id: 'light', name: 'Light', Icon: Sun, note: 'Always light' },
  { id: 'dark', name: 'Dark', Icon: Moon, note: 'Always dark' },
];

/** Application settings, retaining appearance alongside device-local model preferences. */
export function SettingsPage({
  preferences,
  onChange,
}: {
  preferences: ModelPreferences;
  onChange: (value: ModelPreferences) => void;
}) {
  const [section, setSection] = useState<'models' | 'appearance' | 'cost' | 'keys'>('models');
  const [theme, setThemeState] = useState<AppTheme>(() => readAppTheme());
  useEffect(() => {
    document.title = 'Settings · Opsis';
    return () => {
      document.title = 'Opsis';
    };
  }, []);
  // The look applies at once; saving to the account waits until a picker stops moving.
  const [saved, setSaved] = useState<'saved' | 'saving' | 'failed'>('saved');
  const pending = useRef<{ timer: number; theme: AppTheme } | null>(null);
  const save = (next: AppTheme) =>
    saveAppearance(next).then(
      () => setSaved('saved'),
      () => setSaved('failed'),
    );
  useEffect(
    () => () => {
      if (!pending.current) return;
      window.clearTimeout(pending.current.timer);
      void saveAppearance(pending.current.theme).catch(() => undefined);
    },
    [],
  );
  const set = (next: AppTheme) => {
    setThemeState(next);
    applyAppTheme(next);
    writeAppTheme(next);
    setSaved('saving');
    if (pending.current) window.clearTimeout(pending.current.timer);
    pending.current = {
      theme: next,
      timer: window.setTimeout(() => {
        pending.current = null;
        void save(next);
      }, 400),
    };
  };
  const font = fontOf(theme);
  const accent = accentOf(theme);
  const surface = surfaceOf(theme);
  const isDefault = sameTheme(theme, DEFAULT_APP_THEME);
  // What is typed in the hex field while it is being edited; otherwise it shows the colour.
  const [hexDraft, setHexDraft] = useState<string | null>(null);
  const pickCustom = (hex: string) =>
    set({ ...theme, accent: CUSTOM_ACCENT, customAccent: hex.toLowerCase() });

  return (
    <main className="page-main settings-page">
      <header className="page-head">
        <span className="eyebrow">
          <Paintbrush size={13} /> Settings
        </span>
        <h1>Make Opsis yours</h1>
        <p>
          Agents, models, usage and appearance. Model choices, usage and appearance follow your
          account.
        </p>
      </header>

      <div className="settings-sections" role="group" aria-label="Settings sections">
        <button aria-pressed={section === 'keys'} onClick={() => setSection('keys')}>
          API keys
        </button>
        <button aria-pressed={section === 'models'} onClick={() => setSection('models')}>
          Agents and models
        </button>
        <button aria-pressed={section === 'appearance'} onClick={() => setSection('appearance')}>
          Appearance
        </button>
        <button aria-pressed={section === 'cost'} onClick={() => setSection('cost')}>
          Cost projection
        </button>
      </div>
      {section === 'models' && <ModelSettingsPanel preferences={preferences} onChange={onChange} />}
      {section === 'cost' && <CostProjectionPanel />}
      {section === 'keys' && <ApiKeysPanel />}
      {section === 'appearance' && (
        <div className="settings-layout">
          <div className="settings-forms">
            <fieldset className="settings-card">
              <legend>
                <Monitor size={14} /> Colour scheme
              </legend>
              <div className="theme-modes" role="radiogroup" aria-label="Colour scheme">
                {MODES.map(({ id, name, Icon, note }) => (
                  <button
                    type="button"
                    key={id}
                    role="radio"
                    aria-checked={theme.mode === id}
                    onClick={() => set({ ...theme, mode: id })}
                  >
                    <Icon size={18} aria-hidden />
                    <strong>{name}</strong>
                    <small>{note}</small>
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset className="settings-card">
              <legend>
                <Layers size={14} /> Background
              </legend>
              <div className="theme-surfaces" role="radiogroup" aria-label="Background">
                {SURFACE_SCHEMES.map((scheme) => (
                  <button
                    type="button"
                    key={scheme.id}
                    role="radio"
                    aria-checked={theme.surface === scheme.id}
                    onClick={() => set({ ...theme, surface: scheme.id })}
                  >
                    <span className="theme-surface-tile" aria-hidden>
                      {[scheme.light, scheme.dark].map((tokens, index) => (
                        <span
                          key={index}
                          style={{
                            background: tokens.paper,
                            borderColor: tokens.line,
                            color: tokens.ink3,
                          }}
                        >
                          <i style={{ background: tokens.surface, borderColor: tokens.line }} />
                          <b style={{ background: tokens.ink }} />
                          <b style={{ background: tokens.ink3 }} />
                        </span>
                      ))}
                    </span>
                    <span>{scheme.name}</span>
                    {theme.surface === scheme.id && <Check size={14} aria-hidden />}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset className="settings-card">
              <legend>
                <Paintbrush size={14} /> Accent colour
              </legend>
              <div className="theme-accents" role="radiogroup" aria-label="Accent colour">
                {ACCENT_SCHEMES.map((scheme) => (
                  <button
                    type="button"
                    key={scheme.id}
                    role="radio"
                    aria-checked={theme.accent === scheme.id}
                    aria-label={scheme.name}
                    title={scheme.name}
                    style={{ ['--swatch' as string]: scheme.swatch }}
                    onClick={() => set({ ...theme, accent: scheme.id })}
                  >
                    <span className="theme-accent-dot" aria-hidden>
                      {theme.accent === scheme.id && <Check size={13} />}
                    </span>
                    <span>{scheme.name}</span>
                  </button>
                ))}
                <button
                  type="button"
                  role="radio"
                  aria-checked={theme.accent === CUSTOM_ACCENT}
                  aria-label="Custom"
                  title="Custom"
                  className="theme-accent-custom"
                  style={{ ['--swatch' as string]: theme.customAccent ?? accent.swatch }}
                  onClick={() => pickCustom(theme.customAccent ?? accent.swatch)}
                >
                  <span className="theme-accent-dot" aria-hidden>
                    {theme.accent === CUSTOM_ACCENT ? <Check size={13} /> : <Pipette size={12} />}
                  </span>
                  <span>Custom</span>
                </button>
              </div>
              {theme.accent === CUSTOM_ACCENT && (
                <div className="theme-custom-accent">
                  <input
                    type="color"
                    aria-label="Custom colour"
                    value={theme.customAccent ?? accent.swatch}
                    onChange={(event) => pickCustom(event.target.value)}
                  />
                  <input
                    aria-label="Custom colour hex"
                    value={hexDraft ?? theme.customAccent ?? ''}
                    onBlur={() => setHexDraft(null)}
                    maxLength={7}
                    spellCheck={false}
                    onChange={(event) => {
                      const value = event.target.value.trim();
                      const hex = value.startsWith('#') ? value : `#${value}`;
                      setHexDraft(value);
                      if (HEX_COLOUR.test(hex)) pickCustom(hex);
                    }}
                  />
                  <small>Opsis adjusts it for light and dark so text stays readable.</small>
                </div>
              )}
            </fieldset>

            <fieldset className="settings-card">
              <legend>
                <Type size={14} /> Fonts
              </legend>
              <div className="theme-fonts" role="radiogroup" aria-label="Fonts">
                {FONT_SCHEMES.map((scheme) => (
                  <button
                    type="button"
                    key={scheme.id}
                    role="radio"
                    aria-checked={theme.font === scheme.id}
                    onClick={() => set({ ...theme, font: scheme.id })}
                  >
                    <span className="theme-font-name" style={{ fontFamily: scheme.display }}>
                      {scheme.name}
                    </span>
                    <small style={{ fontFamily: scheme.ui }}>{scheme.note}</small>
                    {theme.font === scheme.id && <Check size={15} aria-hidden />}
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="settings-actions">
              <small role="status">
                {saved === 'saving'
                  ? 'Saving…'
                  : saved === 'failed'
                    ? 'Saved in this browser only; your account could not be updated'
                    : 'Saved to your account'}
              </small>
              <button
                type="button"
                className="secondary-button"
                disabled={isDefault}
                onClick={() => set({ ...DEFAULT_APP_THEME })}
              >
                <RotateCcw size={14} /> Reset to default
              </button>
            </div>
          </div>

          <figure className="theme-preview" aria-label="Preview">
            <div className="theme-preview-card">
              <span className="theme-preview-brand">
                <BrandMark size={28} />
                <strong style={{ fontFamily: font.display }}>Aa</strong>
              </span>
              <h2 style={{ fontFamily: font.display }}>See what you mean.</h2>
              <p style={{ fontFamily: font.ui }}>
                Turn a question into a diagram you can explore, play and share.
              </p>
              <div className="theme-preview-row">
                <button
                  type="button"
                  className="theme-preview-primary"
                  style={{ fontFamily: font.ui }}
                >
                  Start a canvas
                </button>
                <a className="theme-preview-link" style={{ fontFamily: font.ui }}>
                  Learn more <ArrowUpRight size={13} />
                </a>
              </div>
              <span className="theme-preview-chips" aria-hidden>
                <span>{surface.name}</span>
                <span>{accent.name}</span>
                <span>{MODES.find((mode) => mode.id === theme.mode)?.name}</span>
                <span>{font.name}</span>
              </span>
            </div>
            <figcaption>Live preview</figcaption>
          </figure>
        </div>
      )}
    </main>
  );
}
