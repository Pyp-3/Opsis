import { useEffect, useMemo, useState } from 'react';
import type { BoardDocument } from '@opsis/schema';
import type { EngineRequest, ProcessResult } from '@opsis/engine';
import { calculateProcess } from './process-engine';

export type ProcessState = {
  status: 'idle' | 'calculating' | 'ready' | 'failed';
  results: Map<string, ProcessResult>;
  message: string;
};
const IDLE: ProcessState = { status: 'idle', results: new Map(), message: '' };

export function useProcessEngine(board: BoardDocument | null): ProcessState {
  const key = JSON.stringify({
    version: 1,
    nodes:
      board?.nodes.flatMap((node) =>
        node.process ? [{ id: node.id, process: node.process }] : [],
      ) ?? [],
  });
  const request = useMemo(() => JSON.parse(key) as EngineRequest, [key]);
  const [state, setState] = useState<{ key: string; value: ProcessState }>({
    key: '',
    value: IDLE,
  });
  useEffect(() => {
    if (!request.nodes.length) return;
    let active = true;
    void Promise.resolve()
      .then(() => calculateProcess(request))
      .then(
        (result) => {
          if (active)
            setState({
              key,
              value: {
                status: 'ready',
                results: new Map(result.nodes.map((node) => [node.id, node])),
                message: '',
              },
            });
        },
        (error) => {
          if (active)
            setState({
              key,
              value: {
                status: 'failed',
                results: new Map(),
                message:
                  error instanceof Error ? error.message : 'The sample could not be calculated.',
              },
            });
        },
      );
    return () => {
      active = false;
    };
  }, [key, request]);
  return !request.nodes.length
    ? IDLE
    : state.key === key
      ? state.value
      : { status: 'calculating', results: new Map(), message: '' };
}
