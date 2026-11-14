# Tooling

Read this before editing `scripts/`, `tests/` or `.github/workflows/`: the TypeScript rules and the no-hang timeouts.

The Node tooling (`scripts/*.mts`, `tests/**/*.mts`) is TypeScript, type-checked with TypeScript 7 and run
by Node itself, which strips the types (on by default from Node 22.18). There is still no build step.

- `npm ci` once, then `npm run typecheck` (`tsc -p .`, `noEmit`, `strict`). It must report 0 errors; CI runs it.
- **Erasable syntax only**: no enums, namespaces or constructor parameter properties. Import types with
  `import type` (`verbatimModuleSyntax`), and write relative imports with the real extension
  (`./chrome.mts`, not `./chrome.mjs`).
- Shared data shapes (a page, its `bh:*` metas, the records passed between `index`, `check`, `cards`,
  `publish` and `bundle`) are named types, not inline objects. Prefer `unknown` and narrow it; `any` only for genuinely dynamic data (JSON, code run in `vm`, DevTools payloads), at the narrowest point.
- **Nothing may hang.** Every job in `.github/workflows/*.yml` sets `timeout-minutes` (a few times its normal
  run, at most 120: `tests/workflows.test.mts` fails otherwise), so a hung step fails in minutes rather than after
  GitHub's 360-minute default. `npm test` passes `--test-timeout=180000`, so a test that is waiting on
  something asynchronous (a request, a child's output) fails by name. It cannot interrupt a blocking
  call such as `spawnSync` without its own `timeout`: the job timeout is the backstop for those. Give a new job a
  timeout, and a test that legitimately needs longer its own `{ timeout }`.
- The browser code stays plain JavaScript, because TypeScript there would need a build step:
  `theme/bh.js`, `theme/modules/*.js`, and the per-page `<script>` blocks. So do `.claude/skills/**` and `figures/**`.
- `scripts/cards.mts` is a social-card staleness input, so editing it (types included) makes every card stale:
  re-run `npm run cards`.
