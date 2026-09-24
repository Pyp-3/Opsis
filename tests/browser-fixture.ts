import { expect, test as base } from '@playwright/test';

const BENIGN_BROWSER_MESSAGES = [
  /WebGL.*software fallback/iu,
  /GL Driver Message/iu,
  /ReadPixels/iu,
];

/** Browser fixture that turns unexpected console warnings/errors and page crashes into failures. */
export const test = base.extend<{ browserProblems: string[] }>({
  browserProblems: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on('console', (message) => {
        if (!['warning', 'error'].includes(message.type())) return;
        const text = message.text();
        if (!BENIGN_BROWSER_MESSAGES.some((pattern) => pattern.test(text))) {
          problems.push(`console.${message.type()}: ${text}`);
        }
      });
      page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
      await use(problems);
      expect(problems, 'unexpected browser console/page errors').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';
