import type { BoardGraph } from './board';
const approval: BoardGraph = {
  title: 'A request and approval process',
  description:
    'A reusable example with approval, revision and cancellation branches. Adapt the roles and conditions to your own process.',
  nodes: [
    {
      id: 'request',
      label: 'Submit request',
      icon: 'clipboard',
      kind: 'step',
      summary: 'Describe the requested work.',
      explanation: 'The requester supplies the purpose, scope and supporting information.',
    },
    {
      id: 'review',
      label: 'Review request',
      icon: 'search',
      kind: 'decision',
      summary: 'Check whether the request is ready.',
      explanation:
        'The reviewer checks completeness and decides to approve, ask for changes or decline.',
    },
    {
      id: 'revise',
      label: 'Revise request',
      icon: 'repeat',
      kind: 'step',
      summary: 'Resolve the review comments.',
      explanation: 'The requester updates the proposal and returns it to review.',
    },
    {
      id: 'deliver',
      label: 'Do the work',
      icon: 'check',
      kind: 'step',
      summary: 'Carry out the approved request.',
      explanation: 'The responsible person completes the work and records the outcome.',
    },
    {
      id: 'closed',
      label: 'Close request',
      icon: 'archive',
      kind: 'step',
      summary: 'Retain the decision and outcome.',
      explanation: 'A completed or declined request is archived with its reason.',
    },
  ],
  edges: [
    { id: 'submit', source: 'request', target: 'review', label: 'Ready for review', kind: 'flow' },
    {
      id: 'changes',
      source: 'review',
      target: 'revise',
      label: 'Changes requested',
      condition: 'Needs more detail',
      kind: 'feedback',
    },
    { id: 'resubmit', source: 'revise', target: 'review', label: 'Resubmit', kind: 'retry' },
    {
      id: 'approve',
      source: 'review',
      target: 'deliver',
      label: 'Approved',
      condition: 'Requirements met',
      kind: 'flow',
    },
    {
      id: 'decline',
      source: 'review',
      target: 'closed',
      label: 'Declined',
      condition: 'Request not accepted',
      kind: 'flow',
    },
    { id: 'done', source: 'deliver', target: 'closed', label: 'Completed', kind: 'flow' },
  ],
  suggestions: ['Who owns each step?', 'Add an escalation branch.'],
};
const pipeline: BoardGraph = {
  title: 'A small data pipeline',
  description:
    'A synthetic, local-only process template. Replace the sample text to explore filtering; no terminal command is executed.',
  nodes: [
    {
      id: 'sample',
      label: 'Sample records',
      icon: 'file',
      kind: 'step',
      summary: 'Three synthetic records.',
      explanation: 'The sample contains two accepted entries and one rejected entry.',
      process: { op: 'source', text: 'accepted: alpha\nrejected: beta\naccepted: gamma' },
    },
    {
      id: 'inspect',
      label: 'Inspect the sample',
      icon: 'search',
      kind: 'step',
      summary: 'Check what each record means.',
      explanation: 'Separate the record status from its content before choosing a transformation.',
    },
    {
      id: 'output',
      label: 'Choose a transformation',
      icon: 'filter',
      kind: 'decision',
      summary: 'Define the desired output.',
      explanation:
        'Use the existing process examples to add a bounded calculation, or describe a transformation for review.',
    },
  ],
  edges: [
    { id: 'read', source: 'sample', target: 'inspect', label: 'Read records', kind: 'flow' },
    { id: 'choose', source: 'inspect', target: 'output', label: 'Choose a rule', kind: 'flow' },
  ],
  suggestions: ['Add a filtering step.', 'Explain the output contract.'],
};
export const PROCESS_EXAMPLES = [approval, pipeline] as const;
