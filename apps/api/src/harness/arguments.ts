import type { HarnessConfig, HarnessFile } from './types.js';

export function harnessArguments(
  config: HarnessConfig,
  schemaPath: string,
  schema = JSON.stringify({ type: 'object' }),
  files: readonly HarnessFile[] = [],
  paths: readonly string[] = [],
): string[] {
  if (config.provider === 'claude') {
    // Tools stay off unless files were uploaded; then only the read-only Read tool is offered,
    // which reads PDFs and images natively from the private workspace.
    const tools = files.length ? ['--tools', 'Read', '--allowedTools', 'Read'] : ['--tools', ''];
    return [
      '--print',
      // Streamed events let the app show the agent's progress live.
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--json-schema',
      schema,
      ...(config.model === 'default' ? [] : ['--model', config.model]),
      ...(config.effort && !config.model.includes('haiku') ? ['--effort', config.effort] : []),
      '--safe-mode',
      '--restricted',
      ...tools,
      '--disable-slash-commands',
      '--strict-mcp-config',
      '--permission-prompts',
      'none',
      '--no-session-persistence',
    ];
  }
  if (config.provider === 'codex') {
    return [
      '--ask-for-approval',
      'never',
      'exec',
      '-',
      ...(config.model === 'default' ? [] : ['--model', config.model]),
      ...(config.effort ? ['--config', `model_reasoning_effort="${config.effort}"`] : []),
      // Concise reasoning summaries become live progress notes.
      '--config',
      'model_reasoning_summary="concise"',
      // Codex attaches images natively; other documents arrive as extracted text.
      ...paths
        .filter((_, index) => files[index]?.kind === 'image')
        .map((path) => `--image=${path}`),
      '--output-schema',
      schemaPath,
      '--json',
      '--ephemeral',
      '--ignore-user-config',
      '--ignore-rules',
      '--sandbox',
      'read-only',
      '--skip-git-repo-check',
      '--color',
      'never',
    ];
  }
  return [
    '--print',
    '--input-format',
    'text',
    '--output-format',
    'json',
    '--json-schema',
    schemaPath,
    '--model',
    config.model,
    '--print-timeout',
    String(Math.max(1, Math.floor(config.timeoutMs / 1000))),
    '--mode',
    'plan',
    '--sandbox',
    '--disable-slash-commands',
    '--log-file',
    '/dev/null',
  ];
}
