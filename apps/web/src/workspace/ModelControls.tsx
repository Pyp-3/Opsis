import { BOARD_MODEL_CHOICES, type BoardModelSettings } from '@opsis/schema';

export function ModelControls({
  agent,
  value,
  disabled,
  onChange,
}: {
  agent: 'claude' | 'codex';
  value: BoardModelSettings;
  disabled: boolean;
  onChange(value: BoardModelSettings): void;
}) {
  const choices = BOARD_MODEL_CHOICES[agent];
  const isCustom = !choices.some((choice) => choice.id === value.model);
  const noEffort = agent === 'claude' && value.model.includes('haiku');
  const isAlias = agent === 'claude' && ['haiku', 'sonnet', 'opus'].includes(value.model);
  const groups = [...new Set(choices.map((choice) => choice.group))];
  return (
    <div className="model-controls">
      <label>
        Model
        <select
          aria-label="Model"
          value={isCustom ? 'custom' : value.model}
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...value, model: event.target.value === 'custom' ? '' : event.target.value })
          }
        >
          {groups.map((group) => (
            <optgroup key={group} label={group}>
              {choices
                .filter((choice) => choice.group === group)
                .map((choice) => (
                  <option key={choice.id} value={choice.id}>
                    {choice.label}
                  </option>
                ))}
            </optgroup>
          ))}
          <option value="custom">Custom model ID…</option>
        </select>
      </label>
      {isCustom && (
        <label className="custom-model">
          Model ID
          <input
            aria-label="Custom model ID"
            value={value.model}
            placeholder={agent === 'claude' ? 'claude-sonnet-…' : 'gpt-…'}
            maxLength={80}
            disabled={disabled}
            onChange={(event) => onChange({ ...value, model: event.target.value })}
          />
        </label>
      )}
      <label>
        Effort
        <select
          aria-label="Reasoning effort"
          value={noEffort ? 'unsupported' : value.effort}
          disabled={disabled || noEffort}
          onChange={(event) =>
            onChange({ ...value, effort: event.target.value as BoardModelSettings['effort'] })
          }
        >
          {noEffort ? (
            <option value="unsupported">Not supported by Haiku</option>
          ) : (
            <>
              <option value="low">Low · economical</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="xhigh">Extra high</option>
              <option value="max">Maximum</option>
            </>
          )}
        </select>
      </label>
      <p className="model-identity">
        <span>Model ID</span> <code>{value.model || 'Enter a model ID'}</code>
        {isAlias && (
          <span className="model-alias-note">
            CLI alias · version depends on your CLI configuration. Choose a versioned model to pin
            it.
          </span>
        )}
      </p>
      <span className="model-usage-note">
        {noEffort ? 'Haiku uses its built-in reasoning. ' : 'Higher effort can use more tokens. '}No
        automatic model upgrades.
      </span>
      <span className="model-usage-note">Model access depends on your agent account.</span>
    </div>
  );
}
