/** Removes stray Markdown code fences and surrounding prose so only the JSON payload remains. */
export function stripFences(raw: string): string {
  let text = raw.trim();
  const fenced = /```[a-zA-Z]*\s*\n?([\s\S]*?)\n?```/u.exec(text);
  if (fenced?.[1] !== undefined) text = fenced[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start > 0 && end > start) text = text.slice(start, end + 1);
  return text;
}

/** Parses JSON, returning the value or a readable error message instead of throwing. */
export function tryParseJson(
  text: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    return { ok: false, error: `Output is not valid JSON: ${(error as Error).message}` };
  }
}
