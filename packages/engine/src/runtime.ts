import init, { evaluate } from '../dist/opsis_engine.js';
import {
  EngineRequestSchema,
  EngineResponseSchema,
  type EngineRequest,
  type EngineResult,
} from './index';

let initialized: Promise<unknown> | undefined;

/** Used in a browser worker; the optional bytes also let tests exercise the actual WASM build. */
export async function calculateInRust(
  request: EngineRequest,
  bytes?: BufferSource,
): Promise<EngineResult> {
  const input = EngineRequestSchema.parse(request);
  initialized ??= init({
    module_or_path: bytes ?? new URL('../dist/opsis_engine_bg.wasm', import.meta.url),
  }).catch((error) => {
    initialized = undefined;
    throw error;
  });
  await initialized;
  const response = EngineResponseSchema.parse(JSON.parse(evaluate(JSON.stringify(input))));
  if (!response.ok) throw new Error(response.error);
  return response.result;
}
