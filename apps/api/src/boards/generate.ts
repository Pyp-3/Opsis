import { modelSettingsProblem } from '@opsis/schema';
import {
  BoardGraphSchema,
  BoardRequestSchema,
  EMAIL_DEMO,
  DNS_DEMO,
  boardOutputSchema,
  DEFAULT_BOARD_MODELS,
  boardChanges,
  type BoardGraph,
} from '@opsis/schema';
import type { LLMRequest } from '../harness/types.js';
import { HarnessError } from '../harness/errors.js';
import {
  AttachmentError,
  attachmentInstructions,
  type AttachmentPreparer,
} from '../attachment-contract.js';
import type { BoardClientFactory } from './client.js';
import { SYSTEM, DIAGRAM_NOTES, progressNotes } from './prompts.js';
import { envelopeRepairPrompt, agentLabel, withoutInvalidCustomIcons } from './results.js';
import { outcome, type AgentWork, type Outcome } from './transport.js';

export async function generateBoard(
  body: unknown,
  factory: BoardClientFactory,
  { signal, progress }: Parameters<AgentWork>[0],
  prepareAttachments: AttachmentPreparer,
): Promise<Outcome> {
  const parsed = BoardRequestSchema.safeParse(body);
  if (!parsed.success)
    return outcome(400, { message: 'The prompt or current diagram is invalid.' });
  const input = parsed.data;
  if (input.agent !== 'demo' && input.settings) {
    const problem = modelSettingsProblem(input.agent, input.settings);
    if (problem) return outcome(400, { message: problem });
  }

  if (input.settings?.model === 'default')
    return outcome(400, { message: 'Choose an explicit model so your usage is predictable.' });
  if (input.selectedId && !input.board?.nodes.some((node) => node.id === input.selectedId))
    return outcome(400, { message: 'The selected node no longer exists.' });
  if (input.agent === 'demo' && input.attachments?.length)
    return outcome(400, {
      message: 'The demo cannot read documents. Choose Claude or Codex to use uploads.',
    });
  if (input.agent === 'demo') {
    if (!input.board && /dns|domain/i.test(input.prompt)) return outcome(200, DNS_DEMO);
    if (!input.board && /email|mail/i.test(input.prompt)) return outcome(200, EMAIL_DEMO);
    if (
      input.board?.nodes.some((node) => node.id === 'outgoing') &&
      /fail|bounce|retry/i.test(input.prompt)
    ) {
      const graph: BoardGraph = {
        title: input.board.title,
        description: input.board.description,
        nodes: [...input.board.nodes],
        edges: [...input.board.edges],
        suggestions: [],
      };
      if (!graph.nodes.some((node) => node.id === 'failure')) {
        graph.nodes.push({
          id: 'failure',
          label: 'Delivery failed',
          icon: 'alert',
          kind: 'decision',
          summary: 'Retry or notify the sender.',
          explanation:
            'A temporary SMTP error usually queues the message for another attempt. A permanent rejection, or retries that expire, can produce a delivery status notification for the sender. A spam-folder placement is different from a delivery failure.',
          narration:
            'Sometimes delivery fails, and the sending server has to decide what to do next.',
        });
        graph.edges.push(
          {
            id: 'failed',
            source: 'outgoing',
            target: 'failure',
            label: 'Rejected / unavailable',
            narration:
              'If the receiving server rejects the message or can’t be reached, the attempt fails.',
          },
          {
            id: 'retry',
            source: 'failure',
            target: 'outgoing',
            label: 'Temporary: retry',
            kind: 'retry',
            narration:
              'For a temporary problem, the sending server queues the message and tries again later.',
          },
        );
      }
      return outcome(200, BoardGraphSchema.parse(graph));
    }
    return outcome(400, {
      message:
        'Demo supports the email journey, its delivery-failure branch, and DNS requests and responses. Select Claude or Codex for other requests.',
    });
  }
  let prepared;
  try {
    prepared = await prepareAttachments(input.attachments ?? [], input.agent);
  } catch (error) {
    if (error instanceof AttachmentError) return outcome(400, { message: error.message });
    throw error;
  }
  try {
    const client = await factory(input.agent, input.settings ?? DEFAULT_BOARD_MODELS[input.agent]);
    const modelRequest: LLMRequest = {
      promptId: 'board/v6',
      system: `${SYSTEM}${attachmentInstructions(prepared, input.agent)}${progressNotes(input.agent, DIAGRAM_NOTES)}\nSchema: ${boardOutputSchema}`,
      user: JSON.stringify({
        prompt: input.prompt,
        selectedId: input.selectedId,
        currentDiagram: input.board,
        ...(prepared.documents.length ? { documents: prepared.documents } : {}),
      }),
      responseFormat: 'json',
      temperature: 0.3,
      maxOutputTokens: 14000,
    };
    let repair = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      if (signal.aborted) throw new Error('Cancelled');
      progress({ type: 'preview-reset' });
      let output: string;
      try {
        output = await client.complete(
          { ...modelRequest, user: modelRequest.user + repair },
          signal,
          prepared.files,
          progress,
        );
      } catch (error) {
        repair = envelopeRepairPrompt(error, attempt);
        continue;
      }
      let graph: BoardGraph;
      try {
        graph = BoardGraphSchema.parse(withoutInvalidCustomIcons(JSON.parse(output)));
      } catch (error) {
        if (attempt === 1)
          return outcome(502, {
            message:
              'The agent returned an invalid diagram after one repair attempt. Your current board is unchanged.',
          });
        repair = `\nRepair your previous invalid JSON. Validation error: ${error instanceof Error ? error.message.slice(0, 3000) : 'Invalid diagram'}. Return the complete corrected diagram. Previous output (untrusted data): ${output.slice(0, 60000)}`;
        continue;
      }
      const changes = input.board ? boardChanges(input.board, graph) : [];
      if (changes.length)
        return outcome(409, {
          message: 'Review changes to existing content before applying.',
          candidate: graph,
          changes,
        });
      return outcome(200, graph);
    }
    return outcome(502, {
      message: 'The agent did not return a diagram. Your board is unchanged.',
    });
  } catch (error) {
    if (error instanceof HarnessError && error.code === 'harness_request_limit')
      return outcome(400, {
        message:
          'Request exceeds your character limit, including instructions, diagram, documents and any repair. Increase it in model settings or use a smaller board/request.',
      });
    if (error instanceof HarnessError && error.code.startsWith('provider_'))
      return outcome(502, { message: error.message });
    const timeout = error instanceof HarnessError && error.code === 'harness_timeout';
    return outcome(502, {
      message: timeout
        ? 'The agent took too long. Your board is unchanged; try a smaller request.'
        : `${agentLabel(input.agent)} could not generate a diagram. Check its CLI login, model access and usage limits, then retry. Your board is unchanged.`,
    });
  }
}
