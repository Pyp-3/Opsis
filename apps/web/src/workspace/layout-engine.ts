import type { ElkNode } from 'elkjs/lib/elk-api';
import workerURL from 'elkjs/lib/elk-worker.min.js?url';

/** Load layout code only on demand, outside the UI thread. The worker is always released. */
export async function arrangeGraph(graph: ElkNode): Promise<ElkNode> {
  if (import.meta.env.MODE === 'test') {
    const { default: ELK } = await import('elkjs/lib/elk.bundled.js');
    return new ELK().layout(graph);
  }
  const { default: ELK } = await import('elkjs/lib/elk-api.js');
  const worker = new Worker(workerURL);
  const elk = new ELK({ workerFactory: () => worker });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      elk.layout(graph),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Layout timed out.')), 15000);
        worker.onerror = () => reject(new Error('Layout worker failed.'));
      }),
    ]);
  } finally {
    clearTimeout(timer);
    worker.terminate();
  }
}
