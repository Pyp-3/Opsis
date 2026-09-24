/** Words allowed in a node or edge label (PROMPT.md §5.5). */
const MAX_LABEL_WORDS = 4;

/** Capitalised text cut to four words (with an ellipsis) so it passes the label rule. */
export function labelFor(text: string): string {
  const words = text
    .trim()
    .replace(/[.!?]+$/u, '')
    .split(/\s+/u);
  const head = words.slice(0, MAX_LABEL_WORDS).join(' ');
  const label = words.length > MAX_LABEL_WORDS ? `${head}…` : head;
  return label.charAt(0).toUpperCase() + label.slice(1);
}
