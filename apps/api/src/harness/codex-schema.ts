import { HarnessError } from './errors';

type Schema = Record<string, unknown>;
const object = (value: unknown): Schema =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Schema) : {};

/**
 * Codex sends --output-schema to OpenAI's strict Structured Outputs endpoint. The stored
 * contracts use draft-7 tuples and optional properties instead. Adapt only the wire schema;
 * the original Zod validators still enforce lengths, shape rules and all persistence limits.
 */
export function codexOutputSchema(json: string): string {
  function convert(value: unknown): Schema {
    const schema = { ...object(value) };
    delete schema.$schema;
    delete schema.minLength;
    delete schema.maxLength;
    delete schema.default;
    if ('const' in schema) {
      schema.enum = [schema.const];
      delete schema.const;
    }
    for (const key of ['$defs', 'definitions', 'properties']) {
      if (!schema[key]) continue;
      schema[key] = Object.fromEntries(
        Object.entries(object(schema[key])).map(([name, child]) => [name, convert(child)]),
      );
    }
    if (schema.properties) {
      const required = new Set((schema.required as string[] | undefined) ?? []);
      const properties = object(schema.properties);
      for (const [name, child] of Object.entries(properties)) {
        if (!required.has(name)) properties[name] = { anyOf: [child, { type: 'null' }] };
      }
      schema.required = Object.keys(properties);
      schema.additionalProperties = false;
    }
    if (Array.isArray(schema.items)) {
      // All Opsis tuples are homogeneous coordinate pairs. A mixed tuple must not be
      // broadened silently; it needs an explicit representation before it reaches Codex.
      const items = schema.items.map(convert);
      if (!items.length || items.some((item) => JSON.stringify(item) !== JSON.stringify(items[0])))
        throw new HarnessError('harness_schema');
      schema.items = items[0];
    } else if (schema.items) schema.items = convert(schema.items);
    if (Array.isArray(schema.anyOf)) schema.anyOf = schema.anyOf.map(convert);
    return schema;
  }
  return JSON.stringify(convert(JSON.parse(json)));
}

/** Restore omitted optional fields before the existing answer validation/review workflow. */
export function codexOutput(json: string, originalSchema: string): string {
  const root = object(JSON.parse(originalSchema));
  function clean(value: unknown, input: unknown): unknown {
    const schema = object(input);
    if (typeof schema.$ref === 'string' && schema.$ref.startsWith('#/')) {
      const target = schema.$ref
        .slice(2)
        .split('/')
        .reduce<unknown>(
          (node, key) => object(node)[key.replace(/~1/g, '/').replace(/~0/g, '~')],
          root,
        );
      return clean(value, target);
    }
    if (Array.isArray(schema.anyOf)) {
      // Select object unions by their literal discriminants. Primitive unions contain no
      // optional properties; their non-matching branches leave the value alone.
      for (const branch of schema.anyOf) {
        const properties = object(object(branch).properties);
        const matches = Object.entries(properties).every(([name, child]) => {
          const field = object(child);
          const actual = object(value)[name];
          return (
            (!('const' in field) || actual === field.const) &&
            (!Array.isArray(field.enum) || field.enum.includes(actual))
          );
        });
        if (matches) value = clean(value, branch);
      }
      return value;
    }
    if (Array.isArray(value))
      return value.map((item, index) =>
        clean(item, Array.isArray(schema.items) ? schema.items[index] : schema.items),
      );
    if (value === null || typeof value !== 'object') return value;
    const properties = object(schema.properties);
    const required = new Set((schema.required as string[] | undefined) ?? []);
    return Object.fromEntries(
      Object.entries(value).flatMap(([name, child]) => {
        // Null required/unknown fields remain invalid, rather than disappearing before review.
        if (child === null && name in properties && !required.has(name)) return [];
        return [[name, clean(child, properties[name])]];
      }),
    );
  }
  return JSON.stringify(clean(JSON.parse(json), root));
}
