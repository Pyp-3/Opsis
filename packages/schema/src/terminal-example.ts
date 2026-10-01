import type { BoardDocument, BoardGraph } from './board';

const SAMPLE_USERS = [
  'alex',
  'blair',
  'casey',
  'devon',
  'ellis',
  'frankie',
  'gray',
  'harper',
  'indigo',
  'jules',
  'kai',
  'logan',
];
const SAMPLE_FILE = SAMPLE_USERS.join('\n');
const SAMPLE_PREVIEW = SAMPLE_USERS.slice(0, 10).join('\n');

/** First terminal-flow reference case. No filesystem access, process execution or model call. */
export const TERMINAL_PIPELINE_EXAMPLE: BoardGraph = {
  title: 'Read the first ten lines',
  description:
    'cat users.txt | head -10 · File → pipe → first 10 lines. Select an icon for a terminal preview.',
  narration:
    'Let’s follow text from a file, through two commands, to the terminal. The commands run concurrently, with a pipe carrying data between them.',
  nodes: [
    {
      id: 'users-file',
      label: 'Text file',
      icon: 'file',
      kind: 'step',
      summary: 'users.txt in the current working directory.',
      explanation:
        'This example assumes a readable, regular text file called users.txt. The filename does not imply any particular format or actual system user accounts. The app has not read your file. A relative path is resolved from the shell’s current working directory.',
      narration:
        'The source is a text file called users dot txt, relative to the shell’s current directory.',
    },
    {
      id: 'read-file',
      label: 'Read the file',
      icon: 'terminal',
      kind: 'step',
      summary: 'cat copies file contents to standard output.',
      explanation:
        'cat opens users.txt and copies its bytes to standard output. In this pipeline standard output is connected to head, rather than directly to the screen. Diagnostics normally go to standard error, which is not carried by the pipe. Neither command modifies the file.',
      narration: 'Cat opens the file and starts sending its contents into the pipe.',
      terminal: {
        command: 'cat users.txt',
        environment: 'Bash · Linux / macOS / WSL',
        input: 'users.txt · 12 example rows',
        exampleInput: SAMPLE_FILE,
        output: SAMPLE_FILE,
        success: 'Readable file → text forwarded',
        issues: [
          {
            symptom: 'No such file or directory',
            cause: 'Missing file or wrong working directory',
            remedy: 'pwd; ls -l users.txt → correct the path',
          },
          {
            symptom: 'Permission denied',
            cause: 'File read or parent-directory access blocked',
            remedy: 'ls -l users.txt; ls -ld . → request authorised access',
          },
          {
            symptom: 'Is a directory',
            cause: 'Path points to a directory',
            remedy: 'ls -ld users.txt → choose a text file',
          },
        ],
      },
    },
    {
      id: 'first-lines',
      label: 'Keep ten lines',
      icon: 'filter',
      kind: 'step',
      summary: 'head reads from the pipe and stops after ten lines.',
      explanation:
        'The shell connects cat’s stdout to head’s stdin using |. Both commands can run concurrently; the diagram shows data flow, not a sequence in which cat must finish first. head has no filename argument, so it reads stdin. -10 is a historical option spelling; prefer -n 10 in scripts.',
      narration: 'The pipe feeds head, which keeps the first ten lines and then stops reading.',
      terminal: {
        command: 'head -10',
        environment: 'Unix head · portable spelling: -n 10',
        input: 'cat stdout → pipe → stdin',
        exampleInput: SAMPLE_FILE,
        output: SAMPLE_PREVIEW,
        success: '0–10 lines → exit 0',
        issues: [
          {
            symptom: 'Fewer than ten lines, or blank output',
            cause: 'Short / empty file, or upstream read failure',
            remedy: 'Check stderr; wc -l users.txt (counts newlines)',
          },
          {
            symptom: 'Invalid option or command not found',
            cause: 'Unix head unavailable or -10 unsupported',
            remedy:
              'Unix: head -n 10 users.txt\nPowerShell: Get-Content users.txt | Select-Object -First 10',
          },
        ],
      },
    },
    {
      id: 'terminal-output',
      label: 'See the result',
      icon: 'monitor',
      kind: 'step',
      summary: 'A preview of the file, with errors on a separate stream.',
      explanation:
        'The screen receives head’s stdout and, unless redirected elsewhere, both commands’ stderr. The exact text depends on the real file; Opsis shows no fabricated user records. This is a read-only preview of at most ten lines, not ten users, and it does not sort, count, or change the file.',
      narration:
        'The terminal displays the preview. Error messages arrive separately, so read them as well as checking the result.',
      terminal: {
        command: 'cat users.txt | head -10',
        environment: 'Bash · read-only · file contents unknown',
        input: 'users.txt → cat → head',
        exampleInput: SAMPLE_FILE,
        output: SAMPLE_PREVIEW,
        success: 'First ≤10 lines · check stderr too',
        issues: [
          {
            symptom: 'cat reports an error, but the pipeline returns 0',
            cause: 'Default pipeline status = last command (head)',
            remedy: 'Check stderr + PIPESTATUS immediately\nSimplify: head -n 10 users.txt',
          },
          {
            symptom: 'Correct preview, but pipefail reports a nonzero status (often 141)',
            cause: 'head closes early → cat may receive SIGPIPE',
            remedy: 'Inspect stderr + individual statuses\nSimplify: head -n 10 users.txt',
          },
        ],
      },
    },
  ],
  edges: [
    { id: 'read', source: 'users-file', target: 'read-file', label: 'Open / read', kind: 'flow' },
    {
      id: 'pipe',
      source: 'read-file',
      target: 'first-lines',
      label: 'stdout → stdin |',
      kind: 'flow',
    },
    {
      id: 'display',
      source: 'first-lines',
      target: 'terminal-output',
      label: 'stdout → screen',
      kind: 'flow',
    },
  ],
};

/** Deliberately narrow prototype recognition, not a general shell parser. */
export function terminalExampleFor(
  prompt: string,
  previous?: BoardDocument | null,
  hasAttachments = false,
): BoardGraph | null {
  if (previous?.nodes.length || hasAttachments) return null;
  const command = 'cat\\s+users\\.txt\\s*\\|\\s*head\\s+(?:-10|-n\\s+10)';
  const patterns = [
    `^${command}[?.]?$`,
    `^\\x60${command}\\x60[?.]?$`,
    `^(?:explain|what does)\\s+\\x60?${command}\\x60?(?:\\s+(?:do|what does it do))?[?.]?$`,
    `^\\x60?${command}\\x60?\\s*[,:]?\\s*(?:what does (?:it|this) do|explain (?:it|this))[?.]?$`,
  ];
  if (!patterns.some((pattern) => new RegExp(pattern, 'i').test(prompt.trim()))) return null;
  const graph = structuredClone(TERMINAL_PIPELINE_EXAMPLE);
  if (/head\s+-n\s+10/i.test(prompt)) {
    graph.nodes[2]!.terminal!.command = 'head -n 10';
    graph.nodes[3]!.terminal!.command = 'cat users.txt | head -n 10';
    graph.description = graph.description.replace('head -10', 'head -n 10');
  }
  return graph;
}
