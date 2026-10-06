import { ModelSettingsPanel } from './ModelSettingsPanel';
import type { ModelPreferences } from './model-settings';
import { useEffect, useState } from 'react';
import { ArrowUpRight, Check, Monitor, Moon, Paintbrush, RotateCcw, Sun, Type } from 'lucide-react';
import {
  ACCENT_SCHEMES,
  DEFAULT_APP_THEME,
  FONT_SCHEMES,
  accentOf,
  applyAppTheme,
  fontOf,
  readAppTheme,
  writeAppTheme,
  type AppTheme,
  type ThemeMode,
} from './app-theme';
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
  const [section, setSection] = useState<'models' | 'appearance'>('models');
  const [theme, setThemeState] = useState<AppTheme>(() => readAppTheme());
  useEffect(() => {
    document.title = 'Settings · Opsis';
    return () => {
      document.title = 'Opsis';
    };
  }, []);
  const set = (next: AppTheme) => {
    setThemeState(next);
    applyAppTheme(next);
    writeAppTheme(next);
  };
  const font = fontOf(theme);
  const accent = accentOf(theme);
  const isDefault =
    theme.mode === DEFAULT_APP_THEME.mode &&
    theme.accent === DEFAULT_APP_THEME.accent &&
    theme.font === DEFAULT_APP_THEME.font;

  return (
    <main className="page-main settings-page">
      <header className="page-head">
        <span className="eyebrow">
          <Paintbrush size={13} /> Settings
        </span>
        <h1>Make Opsis yours</h1>
        <p>Agents, models, usage and appearance. Model choices and usage follow your account.</p>
      </header>

      <div className="settings-sections" role="group" aria-label="Settings sections">
        <button aria-pressed={section === 'models'} onClick={() => setSection('models')}>
          Agents and models
        </button>
        <button aria-pressed={section === 'appearance'} onClick={() => setSection('appearance')}>
          Appearance
        </button>
      </div>
      {section === 'models' && <ModelSettingsPanel preferences={preferences} onChange={onChange} />}
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
              </div>
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
              <small>Saved in this browser</small>
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
