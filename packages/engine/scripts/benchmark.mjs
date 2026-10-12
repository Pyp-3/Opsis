import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { initSync, evaluate } from '../dist/opsis_engine.js';
import { benchmarkCases } from './benchmark-cases.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const engine = resolve(root, 'packages/engine');
const contracts = await build({
  entryPoints: [resolve(engine, 'src/index.ts')],
  write: false,
  bundle: true,
  platform: 'node',
  format: 'esm',
});
const { EngineRequestSchema, EngineResponseSchema } = await import(
  `data:text/javascript;base64,${Buffer.from(contracts.outputFiles[0].contents).toString('base64')}`
);
const bytes = readFileSync(resolve(engine, 'dist/opsis_engine_bg.wasm'));
const initialization = performance.now();
initSync({ module: bytes });
console.log(
  JSON.stringify({ wasmBytes: bytes.length, initializationMs: performance.now() - initialization }),
);

function measure(action) {
  for (let i = 0; i < 20; i++) action();
  const samples = Array.from({ length: 100 }, () => {
    const start = performance.now();
    action();
    return performance.now() - start;
  }).sort((a, b) => a - b);
  return { p50Ms: samples[49], p95Ms: samples[94] };
}
const native = process.argv.includes('--native');
if (native)
  execFileSync('cargo', ['build', '--release', '--locked', '--example', 'benchmark'], {
    cwd: engine,
    stdio: 'inherit',
  });
for (const [name, request] of Object.entries(benchmarkCases())) {
  const input = EngineRequestSchema.parse(request);
  const json = JSON.stringify(input);
  const response = evaluate(json);
  const parsed = JSON.parse(response);
  const result = EngineResponseSchema.parse(parsed);
  if (!result.ok || result.result.nodes.some((node) => node.status !== 'ok'))
    throw new Error(`${name} benchmark failed`);
  console.log(
    JSON.stringify({
      name,
      responseBytes: Buffer.byteLength(response),
      requestValidation: measure(() => EngineRequestSchema.parse(request)),
      stringify: measure(() => JSON.stringify(input)),
      evaluate: measure(() => evaluate(json)),
      parse: measure(() => JSON.parse(response)),
      resultValidation: measure(() => EngineResponseSchema.parse(parsed)),
      complete: measure(() =>
        EngineResponseSchema.parse(
          JSON.parse(evaluate(JSON.stringify(EngineRequestSchema.parse(request)))),
        ),
      ),
    }),
  );
  if (native)
    console.log(
      execFileSync(
        resolve(
          engine,
          `target/release/examples/benchmark${process.platform === 'win32' ? '.exe' : ''}`,
        ),
        [],
        { input: json, encoding: 'utf8' },
      ).trim(),
    );
}
