import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const repository = 'https://github.com/Pyp-3/Opsis';
const pages = new Map([
  ['docs/README.md', 'Home'],
  ['docs/GETTING-STARTED.md', 'Getting-started'],
  ['docs/USER-GUIDE.md', 'User-guide'],
  ['CONTRIBUTING.md', 'Contributing'],
]);
const output = join(root, 'output', 'wiki');
mkdirSync(output, { recursive: true });

for (const [source, title] of pages) {
  const markdown = readFileSync(join(root, source), 'utf8').replace(
    /(\]\()([^\s)]+)(\))/g,
    (match, before, target, after) => {
      if (/^(?:[a-z]+:|#)/i.test(target)) return match;
      const [path, anchor] = target.split('#');
      const resolved = posix.normalize(posix.join(posix.dirname(source), path));
      const wikiTitle = pages.get(resolved);
      const destination = wikiTitle
        ? `${repository}/wiki/${wikiTitle}`
        : `${repository}/blob/main/${resolved}`;
      return `${before}${destination}${anchor ? `#${anchor}` : ''}${after}`;
    },
  );
  writeFileSync(join(output, `${title}.md`), markdown);
}

writeFileSync(
  join(output, '_Sidebar.md'),
  `## Opsis\n\n${[...pages.values()].map((title) => `- [${title.replaceAll('-', ' ')}](${repository}/wiki/${title})`).join('\n')}\n\n- [API reference](${repository}/blob/main/apps/api/README.md)\n- [MCP integration](${repository}/blob/main/apps/mcp/README.md)\n- [Process engine](${repository}/blob/main/docs/PROCESS-ENGINE.md)\n- [Release downloads](${repository}/releases)\n`,
);
writeFileSync(
  join(output, '_Footer.md'),
  `[Opsis repository](${repository}) · [Report a documentation issue](${repository}/issues/new)\n\nThese pages are generated from the repository's documentation with \`pnpm docs:wiki\`.\n`,
);
console.log(`Prepared ${pages.size} wiki pages, sidebar and footer in ${output}`);
