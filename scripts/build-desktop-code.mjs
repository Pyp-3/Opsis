// Independent bundles keep domain rules in their existing TypeScript owners.
await Promise.all([
  import('./build-desktop-contracts.mjs'),
  import('./build-desktop-workflows.mjs'),
  import('./build-desktop-mcp.mjs'),
]);
