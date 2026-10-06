import {
  ACCOUNT_SETTING_KEYS,
  ACCOUNT_SETTING_SCHEMAS,
  UsageRecordSchema,
  type AccountSettingKey,
  type UsageRecord,
} from '@opsis/schema';
import { z } from 'zod';

/**
 * Settings and usage history that belong to the signed-in account. They load once per
 * session; readers then stay synchronous. Before loading (and in isolated component tests)
 * the earlier per-browser storage is used, so nothing is lost while the account loads.
 */
const LEGACY_KEYS: Record<AccountSettingKey, string> = {
  'model-preferences': 'opsis:model-settings:v1',
  'model-profiles': 'opsis:model-profiles:v1',
  'provider-limits': 'opsis:provider:v1',
  'provider-events': 'opsis:provider-usage:v1',
};
const LEGACY_USAGE_KEY = 'opsis:reported-usage:v1';
/** Set once this browser's earlier settings have been copied into an account. */
const IMPORTED_KEY = 'opsis:account-settings-imported:v1';

const values = new Map<AccountSettingKey, unknown>();
let usage: UsageRecord[] = [];
let loaded = false;

function legacy(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? undefined : (JSON.parse(raw) as unknown);
  } catch {
    return undefined;
  }
}

function legacyUsage(): UsageRecord[] {
  const parsed = z.array(z.unknown()).safeParse(legacy(LEGACY_USAGE_KEY) ?? []);
  if (!parsed.success) return [];
  return parsed.data.flatMap((entry) => {
    const record = UsageRecordSchema.safeParse(entry);
    return record.success ? [record.data] : [];
  });
}

async function put(key: AccountSettingKey, value: unknown) {
  const response = await fetch(`/v1/account/settings/${key}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ value }),
  });
  if (!response.ok) throw new Error('Could not save this setting to your account.');
}

async function post(record: UsageRecord) {
  const response = await fetch('/v1/account/usage', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(record),
  });
  if (!response.ok) throw new Error('Could not save usage to your account.');
}

/**
 * Loads the account's settings and usage. The first account to load in a browser that has
 * earlier local settings receives a copy of any it does not already have; local copies stay.
 */
export async function loadAccountSettings() {
  const [settingsResponse, usageResponse] = await Promise.all([
    fetch('/v1/account/settings'),
    fetch('/v1/account/usage'),
  ]);
  if (!settingsResponse.ok || !usageResponse.ok)
    throw new Error('Could not load your account settings.');
  const body = z.object({ values: z.record(z.unknown()) }).parse(await settingsResponse.json());
  values.clear();
  for (const key of ACCOUNT_SETTING_KEYS) {
    const parsed = ACCOUNT_SETTING_SCHEMAS[key].safeParse(body.values[key]);
    if (parsed.success) values.set(key, parsed.data);
  }
  usage = z.array(UsageRecordSchema).parse(await usageResponse.json());
  loaded = true;
  if (legacy(IMPORTED_KEY) !== undefined) return;
  for (const key of ACCOUNT_SETTING_KEYS) {
    if (values.has(key)) continue;
    const parsed = ACCOUNT_SETTING_SCHEMAS[key].safeParse(legacy(LEGACY_KEYS[key]));
    if (!parsed.success) continue;
    await put(key, parsed.data);
    values.set(key, parsed.data);
  }
  if (!usage.length) {
    const records = legacyUsage();
    for (const record of records) await post(record);
    usage = records;
  }
  try {
    localStorage.setItem(IMPORTED_KEY, JSON.stringify(Date.now()));
  } catch {
    // Without storage the import may repeat; it only fills settings the account lacks.
  }
}

/** Forgets the loaded account, e.g. on sign-out. */
export function resetAccountSettings() {
  values.clear();
  usage = [];
  loaded = false;
}

/** The setting's validated value, or undefined when it has never been saved. */
export function accountSetting<K extends AccountSettingKey>(
  key: K,
): z.infer<(typeof ACCOUNT_SETTING_SCHEMAS)[K]> | undefined {
  const value = loaded ? values.get(key) : legacy(LEGACY_KEYS[key]);
  const parsed = ACCOUNT_SETTING_SCHEMAS[key].safeParse(value);
  return parsed.success ? (parsed.data as z.infer<(typeof ACCOUNT_SETTING_SCHEMAS)[K]>) : undefined;
}

/** Validates and saves a setting; it applies immediately and rejects if the account save fails. */
export async function saveAccountSetting<K extends AccountSettingKey>(
  key: K,
  value: z.input<(typeof ACCOUNT_SETTING_SCHEMAS)[K]>,
) {
  const parsed = ACCOUNT_SETTING_SCHEMAS[key].parse(value);
  if (!loaded) {
    localStorage.setItem(LEGACY_KEYS[key], JSON.stringify(parsed));
    return;
  }
  values.set(key, parsed);
  await put(key, parsed);
}

export function accountUsage(): UsageRecord[] {
  return loaded ? usage : legacyUsage();
}

export async function addAccountUsage(record: UsageRecord) {
  if (!loaded) {
    localStorage.setItem(LEGACY_USAGE_KEY, JSON.stringify([...legacyUsage().slice(-99), record]));
    return;
  }
  usage = [...usage, record];
  await post(record);
}

export async function clearAccountUsage() {
  if (!loaded) {
    localStorage.removeItem(LEGACY_USAGE_KEY);
    return;
  }
  const response = await fetch('/v1/account/usage', { method: 'DELETE' });
  if (!response.ok) throw new Error('Could not clear usage history.');
  usage = [];
}
