import { modelSettingsProblem } from '@opsis/schema';
import {
  IllustrateRequestSchema,
  EMAIL_DEMO,
  EMAIL_DEMO_ILLUSTRATIONS,
  DEFAULT_BOARD_MODELS,
  illustrateOutputSchema,
} from '@opsis/schema';
import { HarnessError } from '../harness/errors.js';
import type { BoardClientFactory } from './client.js';
import { ILLUSTRATE_SYSTEM, DRAWING_NOTES, progressNotes } from './prompts.js';
import { envelopeRepairPrompt, agentLabel, acceptIllustrations } from './results.js';
import { outcome, type AgentWork, type Outcome } from './transport.js';

export async function illustrateBoard(
  body: unknown,
  factory: BoardClientFactory,
  { signal, progress }: Parameters<AgentWork>[0],
): Promise<Outcome> {
  const parsed = IllustrateRequestSchema.safeParse(body);
  if (!parsed.success) return outcome(400, { message: 'The diagram is invalid.' });
  const input = parsed.data;
  if (input.agent !== 'demo' && input.settings) {
    const problem = modelSettingsProblem(input.agent, input.settings);
    if (problem) return outcome(400, { message: problem });
  }

  if (input.settings?.model === 'default')
    return outcome(400, { message: 'Choose an explicit model so your usage is predictable.' });
  const ids = new Set(input.board.nodes.map((node) => node.id));
  const wanted = new Set(input.nodeIds ?? ids);
  if ([...wanted].some((id) => !ids.has(id)))
    return outcome(400, { message: 'An object to illustrate no longer exists.' });
  if (input.agent === 'demo') {
    const illustrations = Object.fromEntries(
      [...wanted].flatMap((id) => {
        const drawing = EMAIL_DEMO_ILLUSTRATIONS[id];
        const node = input.board.nodes.find((item) => item.id === id);
        const demo = EMAIL_DEMO.nodes.find((item) => item.id === id);
        return drawing && node?.icon === demo?.icon ? [[id, drawing]] : [];
      }),
    );
    if (!Object.keys(illustrations).length)
      return outcome(400, {
        message:
          'The demo can illustrate the email journey only. Select Claude or Codex to illustrate other boards.',
      });
    return outcome(200, {
      illustrations,
      skipped: [...wanted].filter((id) => !illustrations[id]),
    });
  }
  try {
    const client = await factory(
      input.agent,
      input.settings ?? DEFAULT_BOARD_MODELS[input.agent],
      illustrateOutputSchema,
    );
    const board = input.board;
    const user = JSON.stringify({
      title: board.title,
      description: board.description,
      draw: board.nodes
        .filter((node) => wanted.has(node.id))
        .map((node) => ({
          id: node.id,
          label: node.label,
          icon: node.customIcon?.name ?? node.icon,
          summary: node.summary,
          explanation: node.explanation,
          receives: board.edges
            .filter((edge) => edge.target === node.id)
            .map((edge) => `${edge.label} from ${edge.source}`),
          sends: board.edges
            .filter((edge) => edge.source === node.id)
            .map((edge) => `${edge.label} to ${edge.target}`),
        })),
    });
    let repair = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      if (signal.aborted) throw new Error('Cancelled');
      let output: string;
      try {
        output = await client.complete(
          {
            promptId: 'illustrate/v1',
            system: `${ILLUSTRATE_SYSTEM}${progressNotes(input.agent, DRAWING_NOTES)}\nSchema: ${illustrateOutputSchema}`,
            user: user + repair,
            responseFormat: 'json',
            temperature: 0.6,
            maxOutputTokens: Math.min(32000, 3000 + wanted.size * 1600),
          },
          signal,
          [],
          progress,
        );
      } catch (error) {
        repair = envelopeRepairPrompt(error, attempt);
        continue;
      }
      let result: ReturnType<typeof acceptIllustrations>;
      try {
        result = acceptIllustrations(output, wanted);
      } catch (error) {
        if (attempt === 1) break;
        repair = `\nRepair your previous invalid JSON (${error instanceof Error ? error.message.slice(0, 500) : 'invalid'}). Return all the illustrations again.`;
        continue;
      }
      // One chance to fix drawings that break the rules; valid ones are kept either way.
      if (!Object.keys(result.illustrations).length && attempt === 0) {
        repair = `\nNone of your illustrations were valid. Problems: ${result.problems.join(' | ').slice(0, 3000)}. Return all the illustrations again, following the rules.`;
        continue;
      }
      const { illustrations, skipped } = result;
      return outcome(200, { illustrations, skipped });
    }
    return outcome(502, {
      message:
        'The agent’s drawings were invalid after one repair attempt. Your icons are unchanged.',
    });
  } catch (error) {
    if (error instanceof HarnessError && error.code.startsWith('provider_'))
      return outcome(502, { message: error.message });
    if (error instanceof HarnessError && error.code === 'harness_request_limit')
      return outcome(400, {
        message:
          'Request exceeds your character limit, including instructions, diagram, documents and any repair. Increase it in model settings or use a smaller board/request.',
      });
    const timeout = error instanceof HarnessError && error.code === 'harness_timeout';
    return outcome(502, {
      message: timeout
        ? 'The agent took too long to draw. Your icons are unchanged; try again or choose a faster model.'
        : `${agentLabel(input.agent)} could not draw illustrations. Check its CLI login, model access and usage limits, then retry. Your icons are unchanged.`,
    });
  }
}
