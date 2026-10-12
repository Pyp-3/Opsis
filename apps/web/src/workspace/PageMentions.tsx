import { useState, type KeyboardEvent, type RefObject } from 'react';
import { AtSign, FileText, X } from 'lucide-react';
import { pageMentionText, pageMentions, type PageSummary } from '@opsis/schema';

/** The `@` being typed just before the caret, and what follows it. */
const TYPING = /(?:^|\s)@([\w-]{0,24})$/u;
const MENU_ID = 'page-mention-list';

type Typing = { start: number; query: string };

/** Pages whose number or title matches what follows the `@`. */
function matchingPages(pages: readonly PageSummary[], query: string) {
  const text = query.toLowerCase().replace(/^page-?/u, '');
  return pages
    .map((page, index) => ({ page, number: index + 1 }))
    .filter(
      ({ page, number }) =>
        !text ||
        String(number).startsWith(text) ||
        page.title.toLowerCase().includes(text) ||
        'page'.startsWith(query.toLowerCase()),
    )
    .slice(0, 12);
}

/**
 * `@page` references in a chat message. Typing `@` (or pressing the button) lists the board's
 * pages; choosing one writes `@page3`, which tells the agent to read that page in full. The pages
 * named in the message are shown as chips that can be removed again.
 */
export function usePageMentions({
  pages,
  prompt,
  setPrompt,
  input,
}: {
  /** The board's pages, in order; references are offered only with two or more. */
  pages: readonly PageSummary[];
  prompt: string;
  setPrompt(prompt: string): void;
  input: RefObject<HTMLTextAreaElement>;
}) {
  const [typing, setTyping] = useState<Typing | null>(null);
  const [active, setActive] = useState(0);
  const enabled = pages.length > 1;
  const options = enabled && typing ? matchingPages(pages, typing.query) : [];
  const open = options.length > 0;
  const chosen = Math.min(active, Math.max(0, options.length - 1));

  /** Re-reads the `@` before the caret after typing, clicking or moving the caret. */
  const sync = (text = input.current?.value ?? prompt) => {
    const caret = input.current?.selectionStart ?? text.length;
    const match = enabled ? TYPING.exec(text.slice(0, caret)) : null;
    setTyping(match ? { start: caret - match[1]!.length - 1, query: match[1]! } : null);
    if (!match) setActive(0);
  };

  const insert = (number: number) => {
    const element = input.current;
    const caret = element?.selectionStart ?? prompt.length;
    const start = typing?.start ?? caret;
    const before = prompt.slice(0, start);
    const after = prompt.slice(caret).replace(/^ /u, '');
    const mention = `${pageMentionText(number)} `;
    const next = `${before}${mention}${after}`;
    setPrompt(next);
    setTyping(null);
    setActive(0);
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(before.length + mention.length, before.length + mention.length);
    });
  };

  /** Handles the menu's keys; returns whether the key was used. */
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open) return false;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((chosen + step + options.length) % options.length);
      return true;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      insert(options[chosen]!.number);
      return true;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setTyping(null);
      return true;
    }
    return false;
  };

  /** Starts a reference at the caret, as if `@` had been typed. */
  const begin = () => {
    const element = input.current;
    const caret = element?.selectionStart ?? prompt.length;
    const space = caret > 0 && !/\s/u.test(prompt[caret - 1]!) ? ' ' : '';
    const next = `${prompt.slice(0, caret)}${space}@${prompt.slice(caret)}`;
    setPrompt(next);
    setTyping({ start: caret + space.length, query: '' });
    setActive(0);
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(caret + space.length + 1, caret + space.length + 1);
    });
  };

  const named = enabled ? pageMentions(prompt, pages) : [];
  const remove = (id: string) => {
    const number = pages.findIndex((page) => page.id === id) + 1;
    const pattern = new RegExp(`@page[\\s-]?${number}\\b\\s?`, 'giu');
    setPrompt(prompt.replace(pattern, '').trimStart());
  };

  return {
    enabled,
    sync,
    onKeyDown,
    /** Attributes that tie the prompt to the page list for assistive technology. */
    inputProps: enabled
      ? {
          'aria-autocomplete': 'list' as const,
          ...(open
            ? {
                'aria-controls': MENU_ID,
                'aria-activedescendant': `${MENU_ID}-${options[chosen]!.number}`,
              }
            : {}),
        }
      : {},
    button: enabled ? (
      <button
        type="button"
        className="mention-button"
        aria-label="Reference a page"
        title="Reference a page (@)"
        onClick={begin}
      >
        <AtSign size={16} />
      </button>
    ) : null,
    menu: open ? (
      <ul className="mention-menu" id={MENU_ID} role="listbox" aria-label="Pages to reference">
        {options.map(({ page, number }, index) => (
          <li
            key={page.id}
            id={`${MENU_ID}-${number}`}
            role="option"
            aria-selected={index === chosen}
            className={index === chosen ? 'is-active' : ''}
            // Keep the prompt focused while choosing.
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => insert(number)}
            onPointerEnter={() => setActive(index)}
          >
            <span className="mention-number">{number}</span>
            <span className="mention-title">{page.title}</span>
            {page.hidden && <small>Hidden</small>}
          </li>
        ))}
      </ul>
    ) : null,
    chips: named.length ? (
      <ul className="mention-chips" aria-label="Pages this message references">
        {named.map((id) => {
          const number = pages.findIndex((page) => page.id === id) + 1;
          return (
            <li key={id}>
              <FileText size={12} aria-hidden />
              <span>
                Page {number} · {pages[number - 1]!.title}
              </span>
              <button
                type="button"
                aria-label={`Stop referencing page ${number}`}
                onClick={() => remove(id)}
              >
                <X size={11} />
              </button>
            </li>
          );
        })}
      </ul>
    ) : null,
  };
}
