import type { HarnessConfig, HarnessFile } from './types.js';
import { HarnessError } from './errors';

export function harnessArguments(
  config: HarnessConfig,
  schemaPath: string,
  schema = JSON.stringify({ type: 'object' }),
  files: readonly HarnessFile[] = [],
  paths: readonly string[] = [],
  prompt = '',
): string[] {
  if (config.provider === 'grok') {
    // The official headless interface takes argv. Bound it below Windows' command-line ceiling.
    const input = prompt.includes(schema)
      ? prompt
      : `${prompt}\nReturn only JSON matching this schema:\n${schema}`;
    if (JSON.stringify(input).length > 24000) throw new HarnessError('harness_request_limit');
    return [
      '--no-auto-update',
      '-p',
      input,
      '--model',
      config.model,
      '--output-format',
      'plain',
      '--tools',
      '',
      '--disallowed-tools',
      'Bash,Edit,Read,Grep,MCPTool,WebFetch,WebSearch',
      '--no-plan',
      '--no-subagents',
      '--no-memory',
      '--disable-web-search',
      '--max-turns',
      '1',
    ];
  }
  if (config.provider === 'kimi')
    return [
      '--print',
      '--input-format',
      'text',
      '--output-format',
      'text',
      '--final-message-only',
      '--model',
      config.model,
      '--agent-file',
      'opsis-agent.yaml',
      '--mcp-config-file',
      'opsis-mcp.json',
      '--skills-dir',
      '.',
      '--max-steps-per-turn',
      '1',
      '--max-retries-per-step',
      '0',
      '--max-ralph-iterations',
      '0',
    ];
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
      ...(config.maxBudgetUSD !== undefined
        ? ['--max-budget-usd', String(config.maxBudgetUSD)]
        : []),
      '--safe-mode',
      '--restricted',
      ...tools,
      '--disable-slash-commands',
      '--strict-mcp-config',
      '--permission-prompts',
      'none',
      // A chat thread's session is saved so its next turn can resume it; nothing else is.
      ...(config.session?.id
        ? config.session.resume
          ? ['--resume', config.session.id]
          : ['--session-id', config.session.id]
        : ['--no-session-persistence']),
    ];
  }
  if (config.provider === 'codex') {
    const resume = config.session?.resume && config.session.id;
    return [
      '--ask-for-approval',
      'never',
      'exec',
      // `exec resume` takes the same isolation, with the sandbox set through configuration.
      ...(resume ? ['resume', config.session!.id!, '-'] : ['-']),
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
      // A chat thread's session is saved so its next turn can resume it; nothing else is.
      ...(config.session ? [] : ['--ephemeral']),
      '--ignore-user-config',
      '--ignore-rules',
      ...(resume
        ? ['--config', 'sandbox_mode="read-only"', '--skip-git-repo-check']
        : ['--sandbox', 'read-only', '--skip-git-repo-check', '--color', 'never']),
    ];
  }
  return [
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--json-schema',
    schemaPath,
    '--model',
    config.model,
    '--print-timeout',
    `${Math.max(1, Math.floor(config.timeoutMs / 1000))}s`,
    '--sandbox',
    '--disable-slash-commands',
  ];
}
