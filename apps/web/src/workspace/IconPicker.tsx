import { useState } from 'react';
import type { BoardIcon, CustomIcon } from '@opsis/schema';
import { ICON_CATALOG, ICON_CATEGORIES, searchIcons, type IconCategory } from './icons';
import { NodeIcon } from './NodeIcon';

/**
 * Searchable, categorised icon library. Search matches names, labels and related words. An icon
 * the agent drew is shown as the current choice; picking any library icon replaces it.
 */
export function IconPicker({
  value,
  custom,
  onPick,
}: {
  value: BoardIcon;
  custom?: CustomIcon | undefined;
  onPick: (icon: BoardIcon) => void;
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<IconCategory | 'All'>('All');
  const results = searchIcons(query, category);
  return (
    <div className="icon-picker">
      <input
        aria-label="Search icons"
        placeholder="Search 178 icons — try “payment” or “weather”"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="icon-categories" role="group" aria-label="Icon categories">
        {(['All', ...ICON_CATEGORIES] as const).map((name) => (
          <button
            type="button"
            key={name}
            aria-pressed={category === name}
            onClick={() => setCategory(name)}
          >
            {name}
          </button>
        ))}
      </div>
      <p className="icon-count" aria-live="polite">
        {results.length ? `${results.length} icons` : 'No icons match. Try a broader word.'}
      </p>
      <div className="icon-grid">
        {custom && (
          <button
            type="button"
            className="is-custom"
            aria-label={`Current icon, drawn by the agent: ${custom.name}`}
            aria-pressed
            title={`Drawn by the agent: ${custom.name}`}
          >
            <NodeIcon node={{ icon: value, customIcon: custom }} size={20} />
            <span>{custom.name}</span>
          </button>
        )}
        {results.map((name) => {
          const { icon: Icon, label } = ICON_CATALOG[name];
          return (
            <button
              type="button"
              key={name}
              aria-label={`Use ${label.toLowerCase()} icon`}
              aria-pressed={!custom && value === name}
              title={label}
              onClick={() => onPick(name)}
            >
              <Icon size={20} />
              <span>{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
