import { z } from 'zod';

/**
 * What this Opsis instance allows, so the web app can show only what works here. A local
 * install allows both; a personal server closes sign-up (its operator creates accounts) and
 * runs the agent CLIs configured on the server rather than paths chosen by an account.
 */
export const InstanceInfoSchema = z
  .object({
    /** Anyone reaching the instance may create an account. */
    signup: z.boolean(),
    /** Accounts may choose the CLI executable path used for their requests. */
    accountExecutablePaths: z.boolean(),
  })
  .strict();
export type InstanceInfo = z.infer<typeof InstanceInfoSchema>;

/** A local install: the default, and what an older host without `/v1/instance` means. */
export const LOCAL_INSTANCE: InstanceInfo = { signup: true, accountExecutablePaths: true };
