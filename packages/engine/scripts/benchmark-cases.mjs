/** Bounded synthetic workloads shared by native, WASM and browser measurements. */
export function benchmarkCases() {
  const rows = Array.from({ length: 100 }, (_, i) => `${99 - i}`.padStart(9, '0') + '\n').join('');
  const source = (text) => ({ id: 'source', process: { op: 'source', text } });
  return {
    small: {
      version: 3,
      nodes: [
        source('zuri\nasha\nboni\n'),
        { id: 'head', process: { op: 'head', from: 'source', count: 2 } },
      ],
    },
    maximum: {
      version: 3,
      nodes: [
        source(rows),
        ...Array.from({ length: 49 }, (_, i) => ({
          id: `step-${i}`,
          process: { op: 'pass', from: i ? `step-${i - 1}` : 'source' },
        })),
      ],
    },
    sorting: {
      version: 3,
      nodes: [
        source(rows),
        ...Array.from({ length: 49 }, (_, i) => ({
          id: `sort-${i}`,
          process: {
            op: 'sort',
            from: 'source',
            order: 'asc',
            numeric: i % 2 === 0,
            ignoreCase: i % 2 !== 0,
          },
        })),
      ],
    },
    unicode: {
      version: 3,
      nodes: [
        source('ß\r\nSS\nİ\n😀\n-0002.01\n2.010\n'),
        { id: 'folded', process: { op: 'sort', from: 'source', order: 'asc', ignoreCase: true } },
        { id: 'numeric', process: { op: 'sort', from: 'source', order: 'desc', numeric: true } },
        { id: 'translate', process: { op: 'translate', from: 'folded', set1: 'a-z', set2: 'A-Z' } },
      ],
    },
  };
}
