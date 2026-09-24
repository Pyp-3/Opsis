/** Small deterministic PRNG whose output is stable across JS runtimes. */
export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = Math.trunc(seed) >>> 0 || 0x6d2b79f5;
  }

  /** Returns a value in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  /** Returns a deterministic angle in radians. */
  angle(): number {
    return this.next() * Math.PI * 2;
  }
}

/** Produces a stable RFC 4122 version-4-shaped identifier from the seed and salt. */
export function uuidFromSeed(seed: number, salt = ''): string {
  let hash = (Math.trunc(seed) >>> 0) ^ 0x811c9dc5;
  for (let index = 0; index < salt.length; index += 1) {
    hash ^= salt.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const random = new SeededRandom(hash);
  const bytes = Array.from({ length: 16 }, () => Math.floor(random.next() * 256));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Deterministic timestamp used so a complete OSG is identical for the same input and seed. */
export function timestampFromSeed(seed: number): string {
  const day = Math.abs(Math.trunc(seed)) % 36525;
  return new Date(Date.UTC(2000, 0, 1 + day)).toISOString();
}
