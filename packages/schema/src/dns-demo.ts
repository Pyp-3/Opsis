import type { BoardGraph } from './board';

// Classic iterative resolution: https://www.rfc-editor.org/rfc/rfc1034
export const DNS_DEMO: BoardGraph = {
  title: 'DNS: requests and responses',
  description:
    'Cold-cache lookup: the resolver asks each server and receives a reply. Numbers show message order, not separate actors. Cache hits can skip these queries.',
  narration:
    'Here is what happens when your device looks up google.com and nothing is cached yet. The resolver asks one server after another, and each one replies to it in turn.',
  nodes: [
    {
      id: 'client',
      label: 'Client',
      icon: 'user',
      summary: 'Asks for the address of google.com.',
      explanation:
        'The client sends a recursive query to its configured resolver, then receives the result.',
      kind: 'step',
      narration:
        'It all starts with your device, the client, which needs the numeric address behind google.com.',
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
      narration:
        'The recursive resolver does the legwork, following referrals from server to server on the client’s behalf.',
    },
    {
      id: 'root',
      label: 'Root server',
      icon: 'globe',
      summary: 'Refers the resolver to .com name servers.',
      explanation:
        'The root replies to the resolver. It does not forward this query to the TLD server.',
      kind: 'step',
      narration:
        'A root server doesn’t know the address itself, but it knows which servers look after .com.',
    },
    {
      id: 'tld',
      label: '.com TLD server',
      icon: 'layers',
      summary: 'Refers the resolver to the domain’s authoritative servers.',
      explanation: 'The TLD server replies with a delegation, which the resolver follows.',
      kind: 'step',
      narration: 'The .com server knows which name servers are responsible for google.com.',
    },
    {
      id: 'authoritative',
      label: 'Authoritative server',
      icon: 'shield',
      summary: 'Supplies the requested record.',
      explanation:
        'For this simplified successful lookup, the server returns an address record to the resolver.',
      kind: 'step',
      narration: 'Google’s authoritative server holds the actual record for the name.',
    },
  ],
  edges: [
    {
      id: 'client_query',
      source: 'client',
      target: 'resolver',
      label: '1. Address for google.com?',
      kind: 'request',
      narration: 'First, the client asks its recursive resolver for the address of google.com.',
    },
    {
      id: 'root_query',
      source: 'resolver',
      target: 'root',
      label: '2. Locate the domain',
      kind: 'request',
      narration: 'The resolver has nothing cached, so it starts at the top and asks a root server.',
    },
    {
      id: 'root_reply',
      source: 'root',
      target: 'resolver',
      label: '3. Refer to .com servers',
      kind: 'response',
      narration: 'The root server replies with a referral to the .com servers.',
    },
    {
      id: 'tld_query',
      source: 'resolver',
      target: 'tld',
      label: '4. Locate google.com',
      kind: 'request',
      narration: 'Next, the resolver asks a .com server where google.com lives.',
    },
    {
      id: 'tld_reply',
      source: 'tld',
      target: 'resolver',
      label: '5. Refer to authoritative servers',
      kind: 'response',
      narration: 'The .com server refers it on to Google’s authoritative servers.',
    },
    {
      id: 'auth_query',
      source: 'resolver',
      target: 'authoritative',
      label: '6. Request address record',
      kind: 'request',
      narration: 'The resolver then asks the authoritative server for the address record.',
    },
    {
      id: 'auth_reply',
      source: 'authoritative',
      target: 'resolver',
      label: '7. Address record',
      kind: 'response',
      narration: 'This time the reply is the answer itself: the address record.',
    },
    {
      id: 'client_reply',
      source: 'resolver',
      target: 'client',
      label: '8. Return the answer',
      kind: 'response',
      narration:
        'Finally, the resolver hands that address back to the client, which can now connect.',
    },
  ],
  suggestions: ['Show which queries a cache hit skips', 'Add NXDOMAIN and timeout paths'],
};
