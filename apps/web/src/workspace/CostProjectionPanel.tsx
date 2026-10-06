import { useState } from 'react';
import {
  CostProjectionSettingsSchema,
  DEFAULT_COST_PROJECTION,
  TOKEN_PRICES,
  projectTokenCost,
  type CostProjectionSettings,
  type TokenRates,
} from '@opsis/schema';
import { accountSetting, saveAccountSetting } from './account-settings';

const dollars = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(value);
const tokenFields = [
  ['inputTokens', 'Uncached input tokens'],
  ['cacheReadTokens', 'Cache-read tokens'],
  ['cacheWriteTokens', 'Cache-write tokens'],
  ['outputTokens', 'Output tokens (including reasoning)'],
] as const;
const rateFields: [keyof TokenRates, string][] = [
  ['input', 'Uncached input'],
  ['cacheRead', 'Cache read'],
  ['cacheWrite', 'Cache write'],
  ['output', 'Output'],
];

export function CostProjectionPanel() {
  const [value, setValue] = useState<CostProjectionSettings>(
    () => accountSetting('cost-projection') ?? structuredClone(DEFAULT_COST_PROJECTION),
  );
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const result = projectTokenCost(value);
  const preset = value.price === 'custom' ? null : TOKEN_PRICES[value.price];
  const rates = preset?.rates ?? value.customRates;
  function change(next: CostProjectionSettings) {
    setValue(next);
    setNotice('');
  }
  return (
    <section className="agent-settings settings-card cost-projection" aria-label="Cost projection">
      <h2>Cost projection</h2>
      <p>
        Plan API token costs from explicit assumptions. This calculator makes no model calls and
        does not change your selected agent, usage history or limits.
      </p>
      <label>
        Pricing
        <select
          value={value.price}
          onChange={(event) =>
            change({ ...value, price: event.target.value as CostProjectionSettings['price'] })
          }
        >
          {Object.entries(TOKEN_PRICES).map(([id, price]) => (
            <option key={id} value={id}>
              {price.label} · standard API
            </option>
          ))}
          <option value="custom">Custom rates</option>
        </select>
      </label>
      {preset ? (
        <p>
          <a href={preset.source} target="_blank" rel="noreferrer">
            Published rates
          </a>{' '}
          checked {preset.checked}. Standard global processing;{' '}
          {value.price === 'claude-haiku-4-5'
            ? '5-minute cache writes.'
            : 'Long-context multipliers apply above 272,000 input tokens.'}
        </p>
      ) : (
        <p>
          Enter the applicable rates for your model, region and processing tier. Include any
          long-context premium yourself.
        </p>
      )}
      <div className="projection-fields">
        {rateFields.map(([key, label]) => (
          <label key={key}>
            {label} USD / million tokens
            <input
              type="number"
              min={0}
              max={10000}
              step="any"
              disabled={!!preset}
              value={rates[key]}
              onChange={(event) =>
                change({
                  ...value,
                  customRates: { ...value.customRates, [key]: Number(event.target.value) },
                })
              }
            />
          </label>
        ))}
      </div>
      <p>
        Per-request token assumptions: each token belongs to exactly one input bucket. Include all
        output and reasoning tokens. Count repair attempts as additional requests.
      </p>
      <div className="projection-fields">
        {tokenFields.map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              type="number"
              min={0}
              max={2000000}
              step={1}
              value={value[key]}
              onChange={(event) => change({ ...value, [key]: Number(event.target.value) })}
            />
          </label>
        ))}
        <label>
          Requests per day
          <input
            type="number"
            min={0}
            max={100000}
            step={1}
            value={value.requestsPerDay}
            onChange={(event) => change({ ...value, requestsPerDay: Number(event.target.value) })}
          />
        </label>
      </div>
      {'error' in result ? (
        <p role="alert">{result.error}</p>
      ) : (
        <>
          <dl className="projection-totals">
            <div>
              <dt>Per request</dt>
              <dd>{dollars(result.perRequest)}</dd>
            </div>
            <div>
              <dt>Per day</dt>
              <dd>{dollars(result.perDay)}</dd>
            </div>
            <div>
              <dt>30-day projection</dt>
              <dd>{dollars(result.perMonth)}</dd>
            </div>
          </dl>
          {result.longContext && (
            <p>Long-context pricing applied: 2× input and cache rates, 1.5× output.</p>
          )}
          <figure>
            <figcaption>Projected cumulative API token cost</figcaption>
            <div
              className="projection-chart"
              role="img"
              aria-label={`7 days: ${dollars(result.perDay * 7)}; 30 days: ${dollars(result.perMonth)}; 90 days: ${dollars(result.perDay * 90)}.`}
            >
              {[7, 30, 90].map((days) => (
                <div key={days}>
                  <span>{days} days</span>
                  <span
                    className="projection-bar"
                    style={{ width: result.perDay ? `${(days / 90) * 100}%` : '0%' }}
                  />
                  <strong>{dollars(result.perDay * days)}</strong>
                </div>
              ))}
            </div>
          </figure>
        </>
      )}
      <p>
        Projection only, not a bill. Excludes subscriptions, taxes, tool fees, discounts and
        regional premiums. Actual token counts and prices may change. Unreported usage is never
        treated as zero here; these are the assumptions you entered.
      </p>
      <button
        disabled={
          saving || !CostProjectionSettingsSchema.safeParse(value).success || 'error' in result
        }
        onClick={async () => {
          setSaving(true);
          try {
            await saveAccountSetting('cost-projection', value);
            setNotice('Projection assumptions saved to your account.');
          } catch {
            setNotice('Could not save projection assumptions. Your edits remain here.');
          } finally {
            setSaving(false);
          }
        }}
      >
        {saving ? 'Saving…' : 'Save projection assumptions'}
      </button>
      <p role="status">{notice}</p>
    </section>
  );
}
