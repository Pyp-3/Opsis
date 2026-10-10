import { modelSettingsProblem, preserveBoardLinks } from '@opsis/schema';
import {
  BoardTurnSchema,
  FocusEditsSchema,
  boundChatMemory,
  focusEditProblems,
  type BoardRequest,
  type BoardTurn,
  type FocusEdits,
  BoardGraphSchema,
  BoardRequestSchema,
  AnswerPagesSchema,
  EMAIL_DEMO,
  DNS_DEMO,
  boardOutputSchema,
  boardOutputSchemaFor,
  SketchEditsSchema,
  applySketchEdits,
  type AgentDrawing,
  type SketchEdits,
  DEFAULT_BOARD_MODELS,
  boardChanges,
  type BoardDocument,
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
import {
  SYSTEM,
  DIAGRAM_NOTES,
  CONVERSATION,
  FOCUS,
  DRAWING_FIRST,
  PAGES,
  RESUME,
  progressNotes,
} from './prompts.js';
import { sessionKey } from '../harness/sessions.js';
import { envelopeRepairPrompt, agentLabel, withoutInvalidCustomIcons } from './results.js';
import { outcome, type AgentWork, type Outcome } from './transport.js';

/**
 * The demo's answer to "sketch the mail servers": the same diagram with a small agent sketch, a
 * dashed zone around the sending server, its label and a dimension, so drawing from chat can be
 * tried and tested without an agent.
 */
function emailDemoSketch(board: BoardDocument): BoardGraph {
  return {
    title: board.title,
    description: board.description,
    nodes: [...board.nodes],
    edges: [...board.edges],
    suggestions: board.suggestions ?? [],
    drawings: [
      {
        id: 'provider-zone',
        shape: 'rect',
        anchorId: 'outgoing',
        x: -24,
        y: -24,
        width: 272,
        height: 168,
        ink: 'sky',
        line: 'dashed',
        strokeWidth: 2,
        fill: true,
      },
      {
        id: 'provider-label',
        shape: 'text',
        anchorId: 'outgoing',
        x: -20,
        y: -48,
        text: 'Your provider’s data centre',
        fontSize: 14,
        ink: 'sky',
        line: 'solid',
        strokeWidth: 2,
      },
      {
        id: 'zone-width',
        shape: 'dimension',
        anchorId: 'outgoing',
        points: [
          [-24, 168],
          [248, 168],
        ],
        ink: 'ink',
        line: 'solid',
        strokeWidth: 1,
      },
    ],
  };
}

/**
 * The demo's answer to "widen the zone" on its own sketch: two edits rather than the whole sketch,
 * a wider zone and a new note, so sketch edits and their review can be tried without an agent.
 */
function demoSketchEdits(sketch: readonly AgentDrawing[]): SketchEdits {
  const zone = sketch.find((drawing) => drawing.id === 'provider-zone')!;
  return {
    put: [
      { ...zone, width: (zone.width ?? 272) + 96 },
      {
        id: 'zone-note',
        shape: 'text',
        anchorId: 'outgoing',
        x: (zone.x ?? -24) + (zone.width ?? 272) + 96 - 8,
        y: -48,
        text: 'Room for the outgoing queue',
        fontSize: 12,
        align: 'end',
        ink: 'sky',
        line: 'solid',
        strokeWidth: 2,
      },
    ],
    remove: [],
  };
}

/**
 * Sends the demo's drawings one at a time, as a real agent's sketch streams in, so the canvas's
 * provisional drawing can be seen and tested without an agent.
 */
async function streamDemoDrawings(
  drawings: readonly AgentDrawing[],
  { progress, signal, pause }: Parameters<AgentWork>[0],
) {
  const wait = pause ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  progress({ type: 'phase', phase: 'drafting' });
  for (const drawing of drawings) {
    await wait(300);
    if (signal.aborted) throw new Error('Cancelled');
    progress({ type: 'drawing', drawing });
  }
}

/** The demo's notes: the reader's requests, newest last. */
function demoTurn(input: BoardRequest, reply: string, focusEdits?: FocusEdits): BoardTurn {
  return {
    reply,
    memory: boundChatMemory(
      [input.memory ?? '', `Reader asked: ${input.prompt.split('\n')[0]!.slice(0, 160)}`]
        .filter(Boolean)
        .join('\n'),
    ),
    ...(focusEdits ? { focusEdits } : {}),
  };
}

/**
 * The demo's answer to "dash the selected drawings": restyles the focused drawings it can, so
 * drawing focus and its review can be tried without an agent.
 */
function demoFocusEdits(input: BoardRequest): FocusEdits | null {
  const edits = FocusEditsSchema.safeParse({
    update: (input.focus?.drawings ?? [])
      .filter((drawing) => (drawing.points?.length ?? 0) <= 120)
      .map((drawing) => ({ ...drawing, ink: 'coral', line: 'dashed' })),
    remove: [],
  });
  return edits.success && edits.data.update.length ? edits.data : null;
}

/** A diagram or proposal, with the chat parts of the answer and any further pages beside it. */
function answer(
  input: BoardRequest,
  graph: BoardGraph,
  turn: BoardTurn,
  extraChanges: string[] = [],
  morePages: BoardGraph[] = [],
): Outcome {
  const changes = [...(input.board ? boardChanges(input.board, graph) : []), ...extraChanges];
  if (changes.length && input.board)
    return outcome(409, {
      message: 'Review changes to existing content before applying.',
      candidate: graph,
      changes,
      turn,
    });
  return outcome(200, { ...graph, turn, ...(morePages.length ? { morePages } : {}) });
}

const focusChanges = (edits: FocusEdits | undefined) =>
  edits && (edits.update.length || edits.remove.length)
    ? [
        `Change your selected drawings: ${edits.update.length} updated, ${edits.remove.length} removed`,
      ]
    : [];

/** The agent's chat reply, notes and focus edits, separated from its diagram. */
function readTurn(
  output: Record<string, unknown>,
  input: BoardRequest,
  nodeIds: ReadonlySet<string>,
): BoardTurn {
  const reply = typeof output.reply === 'string' ? output.reply.trim().slice(0, 1200) : '';
  const memory = typeof output.memory === 'string' ? boundChatMemory(output.memory) : input.memory;
  const focusIds = new Set((input.focus?.drawings ?? []).map((drawing) => drawing.id));
  let focusEdits: FocusEdits | undefined;
  if (focusIds.size && output.focusEdits !== undefined && output.focusEdits !== null) {
    focusEdits = FocusEditsSchema.parse(output.focusEdits);
    const problems = focusEditProblems(focusEdits, focusIds, nodeIds);
    if (problems.length) throw new Error(problems.join(' '));
  }
  return BoardTurnSchema.parse({
    ...(reply ? { reply } : {}),
    ...(memory ? { memory } : {}),
    ...(focusEdits ? { focusEdits } : {}),
  });
}

/** Instructions for this turn beyond the diagram rules. */
function turnInstructions(input: BoardRequest) {
  const chat = input.thread || input.conversation?.length || input.memory;
  return `${chat ? CONVERSATION : ''}${input.focus ? FOCUS : ''}${input.priority === 'drawing' ? DRAWING_FIRST : ''}${input.newPages ? PAGES : ''}`;
}

export async function generateBoard(
  body: unknown,
  factory: BoardClientFactory,
  { signal, progress, account, pause }: Parameters<AgentWork>[0],
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
    const focusEdits =
      input.board?.nodes.length && /dash|highlight/i.test(input.prompt)
        ? demoFocusEdits(input)
        : null;
    // The app reviews follow-ups itself, so the demo always answers directly.
    const demoAnswer = (graph: BoardGraph, turn: BoardTurn) => outcome(200, { ...graph, turn });
    if (input.board && focusEdits)
      return demoAnswer(
        BoardGraphSchema.parse({
          title: input.board.title,
          description: input.board.description,
          nodes: input.board.nodes,
          edges: input.board.edges,
          suggestions: input.board.suggestions ?? [],
        }),
        demoTurn(
          input,
          focusEdits.update.length === 1
            ? 'I dashed the drawing you selected in coral, so it reads as proposed work.'
            : `I dashed the ${focusEdits.update.length} drawings you selected in coral, so they read as proposed work.`,
          focusEdits,
        ),
      );
    // A two-page answer: the email journey, then the DNS lookup it starts with.
    if (input.newPages && /email|mail/i.test(input.prompt) && /dns|domain/i.test(input.prompt))
      return outcome(200, {
        ...EMAIL_DEMO,
        turn: demoTurn(
          input,
          'I put the email journey on one page and the DNS lookup it relies on on the next.',
        ),
        morePages: [DNS_DEMO],
      });
    if (!input.board && /dns|domain/i.test(input.prompt))
      return demoAnswer(DNS_DEMO, demoTurn(input, 'Here is how a DNS lookup travels.'));
    if (!input.board && /email|mail/i.test(input.prompt))
      return demoAnswer(EMAIL_DEMO, demoTurn(input, 'Here is how an email reaches its reader.'));
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
      return demoAnswer(
        BoardGraphSchema.parse(graph),
        demoTurn(input, 'I added what happens when delivery fails, with its retry.'),
      );
    }
    const sketch = (input.board?.drawings ?? []) as AgentDrawing[];
    if (
      input.board &&
      sketch.some((drawing) => drawing.id === 'provider-zone') &&
      /widen/i.test(input.prompt)
    ) {
      const edited = applySketchEdits(sketch, demoSketchEdits(sketch));
      await streamDemoDrawings(demoSketchEdits(sketch).put, {
        progress,
        signal,
        ...(pause ? { pause } : {}),
      });
      return demoAnswer(
        BoardGraphSchema.parse({ ...emailDemoSketch(input.board), drawings: edited.drawings }),
        demoTurn(
          input,
          'I widened the data centre and noted the receiving side, as two small edits.',
        ),
      );
    }
    if (
      input.board?.nodes.some((node) => node.id === 'outgoing') &&
      /sketch|draw|plan|layout/i.test(input.prompt)
    ) {
      const graph = BoardGraphSchema.parse(emailDemoSketch(input.board));
      await streamDemoDrawings(graph.drawings ?? [], {
        progress,
        signal,
        ...(pause ? { pause } : {}),
      });
      return demoAnswer(
        graph,
        demoTurn(input, 'I sketched the provider’s data centre around the sending server.'),
      );
    }
    return outcome(400, {
      message:
        'Demo supports the email journey, its delivery-failure branch and a sketch of its mail servers, and DNS requests and responses. Select Claude or Codex for other requests.',
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
    // The agent's earlier sketch, as it is shown it; follow-ups may change it by edits.
    const sketch = (input.board?.drawings ?? []) as AgentDrawing[];
    const schema = boardOutputSchemaFor({
      focus: !!input.focus,
      sketch: sketch.length > 0,
      pages: !!input.newPages,
    });
    const client = await factory(
      input.agent,
      input.settings ?? DEFAULT_BOARD_MODELS[input.agent],
      ...(schema !== boardOutputSchema ? [schema] : []),
    );
    const turn = turnInstructions(input);
    const notes = `${attachmentInstructions(prepared, input.agent)}${progressNotes(input.agent, DIAGRAM_NOTES)}`;
    const shared = {
      ...(input.memory ? { memory: input.memory } : {}),
      selectedId: input.selectedId,
      ...(input.priority ? { priority: input.priority } : {}),
      ...(input.focus ? { focus: input.focus } : {}),
      currentDiagram: input.board,
      ...(prepared.documents.length ? { documents: prepared.documents } : {}),
    };
    const key = sessionKey(account, input.thread);
    const lastOutcome = [...(input.conversation ?? [])]
      .reverse()
      .find((message) => message.role === 'assistant')?.outcome;
    const modelRequest: LLMRequest = {
      promptId: 'board/v8',
      system: `${SYSTEM}${turn}${notes}\nSchema: ${schema}`,
      user: JSON.stringify({
        prompt: input.prompt,
        ...(input.conversation?.length ? { conversation: input.conversation } : {}),
        ...shared,
      }),
      responseFormat: 'json',
      temperature: 0.3,
      // Room for a large sketch beside the diagram; follow-ups send sketch edits, not the whole.
      maxOutputTokens: 24000,
      ...(key
        ? {
            session: {
              key,
              resumeSystem: `${RESUME}${turn}${notes}`,
              resumeUser: JSON.stringify({
                prompt: input.prompt,
                ...(lastOutcome ? { lastOutcome } : {}),
                ...shared,
              }),
            },
          }
        : {}),
    };
    let repair = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      if (signal.aborted) throw new Error('Cancelled');
      progress({ type: 'preview-reset' });
      let output: string;
      try {
        output = await client.complete(
          {
            ...modelRequest,
            user: modelRequest.user + repair,
            ...(modelRequest.session
              ? {
                  session: {
                    ...modelRequest.session,
                    resumeUser: modelRequest.session.resumeUser + repair,
                  },
                }
              : {}),
          },
          signal,
          prepared.files,
          progress,
        );
      } catch (error) {
        repair = envelopeRepairPrompt(error, attempt);
        continue;
      }
      let graph: BoardGraph;
      let turn: BoardTurn;
      let morePages: BoardGraph[] = [];
      try {
        const {
          reply,
          memory,
          focusEdits,
          sketchEdits,
          morePages: pages,
          ...content
        } = JSON.parse(output) as Record<string, unknown>;
        // Further pages only when the reader asked for new pages; each is a complete diagram.
        if (input.newPages && pages !== undefined && pages !== null)
          morePages = AnswerPagesSchema.parse(
            Array.isArray(pages) ? pages.map(withoutInvalidCustomIcons) : pages,
          );
        if (sketchEdits !== undefined && sketchEdits !== null) {
          if (content.drawings !== undefined)
            throw new Error('Return either "drawings" or "sketchEdits", not both.');
          const edited = applySketchEdits(sketch, SketchEditsSchema.parse(sketchEdits));
          if (!edited.drawings) throw new Error(edited.problems.join(' '));
          content.drawings = edited.drawings;
        }
        graph = preserveBoardLinks(
          BoardGraphSchema.parse(withoutInvalidCustomIcons(content)),
          input.board,
        );
        turn = readTurn(
          { reply, memory, focusEdits },
          input,
          new Set(graph.nodes.map((node) => node.id)),
        );
      } catch (error) {
        if (attempt === 1)
          return outcome(502, {
            message:
              'The agent returned an invalid diagram after one repair attempt. Your current board is unchanged.',
          });
        repair = `\nRepair your previous invalid JSON. Validation error: ${error instanceof Error ? error.message.slice(0, 3000) : 'Invalid diagram'}. Return the complete corrected diagram. Previous output (untrusted data): ${output.slice(0, 60000)}`;
        continue;
      }
      return answer(input, graph, turn, focusChanges(turn.focusEdits), morePages);
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
    if (error instanceof HarnessError && error.code === 'harness_session')
      return outcome(502, {
        message: `${agentLabel(input.agent)} could not resume this thread’s saved session, so it was set aside. Send again to continue from the thread’s notes. Your board is unchanged.`,
      });
    const timeout = error instanceof HarnessError && error.code === 'harness_timeout';
    return outcome(502, {
      message: timeout
        ? 'The agent took too long. Your board is unchanged; try a smaller request.'
        : `${agentLabel(input.agent)} could not generate a diagram. Check its CLI login, model access and usage limits, then retry. Your board is unchanged.`,
    });
  }
}
