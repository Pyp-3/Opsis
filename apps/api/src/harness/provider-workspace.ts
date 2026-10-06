import type { HarnessProvider } from './types';

export function providerEnvironment(provider: HarnessProvider): Record<string, string> {
  if (provider === 'agy')
    return {
      HOME: '.',
      USERPROFILE: '.',
      APPDATA: '.',
      LOCALAPPDATA: '.',
      XDG_CONFIG_HOME: '.',
      XDG_DATA_HOME: '.',
    };
  if (provider !== 'grok') return {};
  return Object.fromEntries(
    [
      'GROK_CURSOR_SKILLS_ENABLED',
      'GROK_CURSOR_RULES_ENABLED',
      'GROK_CURSOR_AGENTS_ENABLED',
      'GROK_CURSOR_MCPS_ENABLED',
      'GROK_CURSOR_HOOKS_ENABLED',
      'GROK_CLAUDE_SKILLS_ENABLED',
      'GROK_CLAUDE_RULES_ENABLED',
      'GROK_CLAUDE_AGENTS_ENABLED',
      'GROK_CLAUDE_MCPS_ENABLED',
      'GROK_CLAUDE_HOOKS_ENABLED',
      'GROK_WRITE_FILE',
      'GROK_TOOL_SEARCH',
      'GROK_MEMORY',
      'GROK_SUBAGENTS',
    ].map((key) => [key, '0']),
  );
}

/** Fixed files only; callers stage them inside the private, disposable workspace. */
export function providerWorkspaceFiles(
  provider: HarnessProvider,
  schema: string,
): Record<string, string> {
  if (provider === 'agy')
    return {
      '.gemini/antigravity-cli/settings.json': JSON.stringify({
        toolPermission: 'strict',
        artifactReviewPolicy: 'asks-for-review',
        permissions: {
          allow: [],
          ask: [],
          deny: [
            'read_file(*)',
            'write_file(*)',
            'command(*)',
            'unsandboxed(*)',
            'read_url(*)',
            'execute_url(*)',
            'mcp(*)',
          ],
        },
      }),
    };
  if (provider !== 'kimi') return {};
  return {
    'opsis-agent.yaml':
      'version: 1\nagent:\n  name: opsis\n  system_prompt_path: ./opsis-system.md\n  tools: []\n',
    'opsis-system.md': `Return only one JSON object matching the supplied instructions and this schema:\n${schema}\nDo not use tools.`,
    'opsis-mcp.json': '{"mcpServers":{}}',
  };
}
