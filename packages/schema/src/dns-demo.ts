import type { BoardGraph } from './board';

// Classic iterative resolution: https://www.rfc-editor.org/rfc/rfc1034
export const DNS_DEMO: BoardGraph = {
  title: 'DNS: requests and responses',
  description:
    'Cold-cache lookup: the resolver asks each server and receives a reply. Numbers show message order, not separate actors. Cache hits can skip these queries.',
  nodes: [
    {
      id: 'client',
      label: 'Client',
      icon: 'user',
      summary: 'Asks for the address of google.com.',
      explanation:
        'The client sends a recursive query to its configured resolver, then receives the result.',
      kind: 'step',
    },
    {
      id: 'resolver',
      label: 'Recursive resolver',
      icon: 'server',
      summary: 'Follows referrals on behalf of the client.',
      explanation:
        'With no cached answer or delegation, it queries root, then .com, then the authoritative server. Replies come back here; the resolver returns the final answer to the client.',
      kind: 'step',
      confidence: 'simplified',
      caveat:
        'Shows classic iterative resolution without aliases, DNSSEC validation or query-name minimization.',
    },
    {
      id: 'root',
      label: 'Root server',
      icon: 'globe',
      summary: 'Refers the resolver to .com name servers.',
      explanation:
        'The root replies to the resolver. It does not forward this query to the TLD server.',
      kind: 'step',
    },
    {
      id: 'tld',
      label: '.com TLD server',
      icon: 'layers',
      summary: 'Refers the resolver to the domain’s authoritative servers.',
      explanation: 'The TLD server replies with a delegation, which the resolver follows.',
      kind: 'step',
    },
    {
      id: 'authoritative',
      label: 'Authoritative server',
      icon: 'shield',
      summary: 'Supplies the requested record.',
      explanation:
        'For this simplified successful lookup, the server returns an address record to the resolver.',
      kind: 'step',
    },
  ],
  edges: [
    {
      id: 'client_query',
      source: 'client',
      target: 'resolver',
      label: '1. Address for google.com?',
      kind: 'request',
    },
    {
      id: 'root_query',
      source: 'resolver',
      target: 'root',
      label: '2. Locate the domain',
      kind: 'request',
    },
    {
      id: 'root_reply',
      source: 'root',
      target: 'resolver',
      label: '3. Refer to .com servers',
      kind: 'response',
    },
    {
      id: 'tld_query',
      source: 'resolver',
      target: 'tld',
      label: '4. Locate google.com',
      kind: 'request',
    },
    {
      id: 'tld_reply',
      source: 'tld',
      target: 'resolver',
      label: '5. Refer to authoritative servers',
      kind: 'response',
    },
    {
      id: 'auth_query',
      source: 'resolver',
      target: 'authoritative',
      label: '6. Request address record',
      kind: 'request',
    },
    {
      id: 'auth_reply',
      source: 'authoritative',
      target: 'resolver',
      label: '7. Address record',
      kind: 'response',
    },
    {
      id: 'client_reply',
      source: 'resolver',
      target: 'client',
      label: '8. Return the answer',
      kind: 'response',
    },
  ],
  suggestions: ['Show which queries a cache hit skips', 'Add NXDOMAIN and timeout paths'],
};
