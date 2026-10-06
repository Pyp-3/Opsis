import { BOARD_MODEL_CHOICES, type BoardModelSettings, type ProviderAgent } from '@opsis/schema';

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
const EFFORT_LABELS: Record<BoardModelSettings['effort'], string> = {
  low: 'Low · economical',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Maximum',
};

export function ModelControls({
  agent,
  value,
  disabled,
  onChange,
}: {
  agent: ProviderAgent;
  value: BoardModelSettings;
  disabled: boolean;
  onChange(value: BoardModelSettings): void;
}) {
  const choices = BOARD_MODEL_CHOICES[agent];
  const isCustom = !choices.some((choice) => choice.id === value.model);
  const noEffort =
    (agent === 'claude' && value.model.includes('haiku')) ||
    agent === 'grok' ||
    agent === 'antigravity' ||
    (agent === 'kimi' && value.connection !== 'api');
  const isAlias = agent === 'claude' && ['haiku', 'sonnet', 'opus', 'fable'].includes(value.model);
  const efforts =
    choices.find((choice) => choice.id === value.model)?.efforts ??
    (agent === 'kimi' ? (['low', 'high', 'max'] as const) : EFFORTS);
  const effort = efforts.includes(value.effort) ? value.effort : efforts[0]!;
  const groups = [...new Set(choices.map((choice) => choice.group))];
  return (
    <div className="model-controls">
      <label>
        Model
        <select
          aria-label="Model"
          value={isCustom ? 'custom' : value.model}
          disabled={disabled}
          onChange={(event) => {
            const model = event.target.value === 'custom' ? '' : event.target.value;
            const allowed = choices.find((choice) => choice.id === model)?.efforts ?? EFFORTS;
            onChange({
              ...value,
              model,
              effort: allowed.includes(value.effort) ? value.effort : allowed[0]!,
            });
          }}
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
          value={noEffort ? 'unsupported' : effort}
          disabled={disabled || noEffort}
          onChange={(event) =>
            onChange({ ...value, effort: event.target.value as BoardModelSettings['effort'] })
          }
        >
          {noEffort ? (
            <option value="unsupported">
              {agent === 'claude' ? 'Not supported by Haiku' : 'Built-in reasoning'}
            </option>
          ) : (
            efforts.map((level) => (
              <option key={level} value={level}>
                {EFFORT_LABELS[level]}
              </option>
            ))
          )}
        </select>
      </label>
      {((!value.model.includes('haiku') && !value.model.includes('luna')) ||
        ['high', 'xhigh', 'max'].includes(value.effort)) && (
        <p className="model-cost-warning">
          This model or effort may use substantially more tokens or cost more than the economical
          default. Check your provider’s current pricing and account allowance before generating.
        </p>
      )}
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
        {noEffort
          ? 'This connection uses built-in reasoning. '
          : 'Higher effort can use more tokens. '}
        No automatic model upgrades.
      </span>
      <span className="model-usage-note">Model access depends on your agent account.</span>
    </div>
  );
}
