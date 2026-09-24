import type { SemanticGraph } from './contracts';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

/** Serializes JSON-compatible values with recursively sorted object keys. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/** Produces a deterministic, browser-safe 64-bit FNV-1a hash. */
export function stableHash(value: unknown): string {
  let hash = 0xcbf29ce484222325n;
  for (const character of stableStringify(value)) {
    hash ^= BigInt(character.codePointAt(0) as number);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

/** Creates the stable Semantic Graph reference stored by a Visual Plan. */
export function createSgRef(graph: SemanticGraph): string {
  return `sg_${stableHash(graph)}`;
}

/** Creates the cache key defined by PROMPT.md §11. */
export function createCacheKey(
  stage: string,
  normalizedInput: unknown,
  config: unknown,
  modelId: string,
): string {
  return `cache_${stableHash({ stage, normalizedInput, config, modelId })}`;
}
