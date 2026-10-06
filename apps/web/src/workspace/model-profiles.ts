import { ModelProfileSchema, type ModelProfile } from '@opsis/schema';
import { accountSetting, saveAccountSetting } from './account-settings';

export { ModelProfileSchema, type ModelProfile };
/** The account's named model profiles. */
export function readModelProfiles(): ModelProfile[] {
  return accountSetting('model-profiles') ?? [];
}
/** Rejects invalid profiles or a failed account save. */
export function writeModelProfiles(profiles: ModelProfile[]) {
  return saveAccountSetting('model-profiles', profiles);
}
