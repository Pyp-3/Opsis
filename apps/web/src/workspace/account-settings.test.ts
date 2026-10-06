// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_COST_PROJECTION } from '@opsis/schema';
import {
  accountSetting,
  accountUsage,
  loadAccountSettings,
  resetAccountSettings,
  saveAccountSetting,
} from './account-settings';

type Call = { url: string; method: string; body?: unknown };

/** A fake account API that records writes. */
function serve(values: Record<string, unknown>, usage: unknown[] = []) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({
        url,
        method,
        ...(init?.body ? { body: JSON.parse(String(init.body)) as unknown } : {}),
      });
      if (url === '/v1/account/settings') return Response.json({ values });
      if (url === '/v1/account/usage' && method === 'GET') return Response.json(usage);
      return new Response(null, { status: 204 });
    }),
  );
  return calls;
}

const record = {
  id: '6f1f8f5e-8e8f-4d0b-9c39-0b3b39c6b0a1',
  at: 5,
  agent: 'claude',
  model: 'haiku',
  effort: 'low',
  purpose: 'diagram',
  attempts: [],
};

afterEach(() => {
  resetAccountSettings();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('account settings', () => {
  it('keeps new account-only settings out of legacy browser storage', async () => {
    await expect(saveAccountSetting('cost-projection', DEFAULT_COST_PROJECTION)).rejects.toThrow(
      'Account settings have not loaded.',
    );
    expect(localStorage.length).toBe(0);
    expect(accountSetting('cost-projection')).toBeUndefined();
    const calls = serve({});
    await loadAccountSettings();
    await saveAccountSetting('cost-projection', DEFAULT_COST_PROJECTION);
    expect(calls.at(-1)).toMatchObject({
      url: '/v1/account/settings/cost-projection',
      method: 'PUT',
    });
    expect(accountSetting('cost-projection')).toEqual(DEFAULT_COST_PROJECTION);
    resetAccountSettings();
    expect(accountSetting('cost-projection')).toBeUndefined();
  });

  it('imports this browser’s earlier settings once, only where the account has none', async () => {
    localStorage.setItem(
      'opsis:model-settings:v1',
      JSON.stringify({ claude: { model: 'sonnet', effort: 'medium' } }),
    );
    localStorage.setItem(
      'opsis:model-profiles:v1',
      JSON.stringify([
        { id: 'p', name: 'Local', agent: 'claude', settings: { model: 'opus', effort: 'high' } },
      ]),
    );
    localStorage.setItem('opsis:reported-usage:v1', JSON.stringify([record]));
    const accountProfiles = [
      {
        id: 'a',
        name: 'Account',
        agent: 'codex',
        settings: { model: 'gpt-6-luna', effort: 'low' },
      },
    ];
    const calls = serve({ 'model-profiles': accountProfiles });
    await loadAccountSettings();
    expect(accountSetting('model-preferences')).toEqual({
      claude: { model: 'sonnet', effort: 'medium' },
    });
    // The account's own value wins over the browser's.
    expect(accountSetting('model-profiles')).toEqual(accountProfiles);
    expect(calls.filter((call) => call.method === 'PUT').map((call) => call.url)).toEqual([
      '/v1/account/settings/model-preferences',
    ]);
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    expect(accountUsage()).toEqual([record]);
    // Local copies stay; a later account in this browser does not inherit them.
    expect(localStorage.getItem('opsis:model-settings:v1')).not.toBeNull();
    resetAccountSettings();
    const later = serve({});
    await loadAccountSettings();
    expect(accountSetting('model-preferences')).toBeUndefined();
    expect(later.filter((call) => call.method !== 'GET')).toEqual([]);
  });

  it('saves to the account and rejects invalid values or failed saves', async () => {
    const calls = serve({});
    localStorage.setItem('opsis:account-settings-imported:v1', '1');
    await loadAccountSettings();
    await saveAccountSetting('provider-limits', {
      enabled: true,
      caps: { claude: { fiveHour: 3, weekly: 0 }, codex: { fiveHour: 0, weekly: 0 } },
    });
    expect(calls.at(-1)).toMatchObject({
      url: '/v1/account/settings/provider-limits',
      method: 'PUT',
    });
    expect(accountSetting('provider-limits')?.caps.claude.fiveHour).toBe(3);
    await expect(
      saveAccountSetting('model-profiles', [{ id: 'x', name: '', agent: 'claude' }] as never),
    ).rejects.toThrow();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 500 })),
    );
    await expect(
      saveAccountSetting('model-preferences', { codex: { model: 'gpt-6-luna', effort: 'low' } }),
    ).rejects.toThrow('Could not save this setting to your account.');
  });
});
