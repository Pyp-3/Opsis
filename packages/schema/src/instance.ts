import { z } from 'zod';

/**
 * What this Opsis instance allows, so the web app can show only what works here. A local
 * install allows both; a personal server closes sign-up (its operator creates accounts) and
 * runs the agent CLIs configured on the server rather than paths chosen by an account.
 */
/**
 * The HTTP API generation the bundled web app speaks. The desktop app connects to a remote
 * server only when the server reports the same number, because its pages are bundled with the
 * app rather than loaded from the server. Raise it with any change an older app cannot use.
 */
export const OPSIS_API_VERSION = 1;

export const InstanceInfoSchema = z
  .object({
    /** Anyone reaching the instance may create an account. */
    signup: z.boolean(),
    /** Accounts may choose the CLI executable path used for their requests. */
    accountExecutablePaths: z.boolean(),
    /**
     * Accounts may run Claude's and Codex's CLIs with full access (tools, skills, MCP servers
     * and no permission prompts). A local install allows it; a server only when its operator
     * sets `OPSIS_AGENT_FULL_ACCESS=1`. Absent on hosts from before it existed: not allowed.
     */
    agentFullAccess: z.boolean().optional(),
    /** See OPSIS_API_VERSION; absent on hosts from before it existed. */
    api: z.number().int().positive().optional(),
  })
  .strict();
export type InstanceInfo = z.infer<typeof InstanceInfoSchema>;

/** A local install: the default, and what an older host without `/v1/instance` means. */
export const LOCAL_INSTANCE: InstanceInfo = {
  signup: true,
  accountExecutablePaths: true,
  agentFullAccess: true,
  api: OPSIS_API_VERSION,
};
