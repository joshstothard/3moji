# Quality Strategy

<!-- TEMPLATE: Fill in your project's specific test layout, runner choices, and
     coverage thresholds. The structure below is what the agent contract expects. -->

## Test Pyramid

| Layer       | Scope                                            | Runs                                                                             |
| ----------- | ------------------------------------------------ | -------------------------------------------------------------------------------- |
| Unit        | One function/class, all dependencies mocked      | pre-push, CI on every push                                                       |
| Integration | Module + real infrastructure (DB, queue) locally | CI on every push                                                                 |
| E2E         | Full stack through the browser                   | CI on every push                                                                 |
| Mutation    | The tests themselves (Stryker or equivalent)     | full run on demand (`nightly-mutation` workflow, manual dispatch — see ADR-0002) |
| Security    | OWASP scanning, dependency audit                 | CI on every push                                                                 |
| A11y        | WCAG AA via axe-core or equivalent               | CI on every push                                                                 |

## Standards

- **Coverage floor:** 70% unit coverage. Never reduce it.
- **Observed red:** every test is seen failing for the right reason before it counts (see `AGENTS.md` § TDD Workflow).
- **Scripts that make decisions are unit-tested:** `scripts/*.test.mjs` run under Node's built-in test runner (`npm run test:scripts`), in `scripts/verify.sh` and CI. Keep the decision a pure function the tests can call without GitHub or the network, as `scripts/auto-merge.mjs` does with `evaluate()`.
- **Tests assert behaviour, not implementation** — a test that breaks on refactor without a behaviour change is a bad test.
- **Mutation testing keeps the tests honest:** coverage proves code was executed; mutants prove the assertions actually constrain it. Surviving mutants are reported by the full Stryker run, dispatched manually from the Actions tab (its nightly schedule is disabled per ADR-0002).
- **Flakes are defects:** a test that fails non-deterministically more than twice in 7 days gets a GitHub issue (see `nightly-check`).
- **No hard-coded credentials in tests:** tests read credentials from environment variables and throw clearly when absent. The only exception is a mocked secrets provider returning fixture values.

## API unit tests (`apps/api`)

API tests run under Jest 30 + ts-jest against CommonJS test files. NestJS 12 packages are ESM-only (`"type": "module"`), and the API deliberately stays CommonJS, so every spec `require()`s an ES module.

- **Jest loads ESM through `require()` only when Node exposes `vm.SourceTextModule.prototype.hasAsyncGraph`** — Node 24.9+, and only with `--experimental-vm-modules`. Without the flag every suite fails before any test runs with `Must use import to load ES Module: …/@nestjs/testing/index.js`.
- The flag therefore lives in the `apps/api` `test` script itself: `node --experimental-vm-modules ../../node_modules/jest/bin/jest.js --coverage` (Jest's documented form, and portable to Windows `cmd.exe`, unlike an inline `NODE_OPTIONS=` prefix). Run the tests through `npm test`, not bare `npx jest`.
- Each Jest worker prints a `VM Modules is an experimental feature` warning. It is expected; do not suppress it.
- Anything that spawns Jest itself (a Stryker Jest runner, an IDE test runner) does not inherit the script's flag and must pass `--experimental-vm-modules` (e.g. via `NODE_OPTIONS`) on its own.

## Web unit tests (`apps/web`)

Web tests run under Jest + `jest-environment-jsdom` with React Testing Library. Conventions:

- **Async server components** are rendered by awaiting the component function and passing the result to `render` — e.g. `render(await ObjectivesPage())`, or `render(await ObjectivePage({ params: Promise.resolve({ id }) }))` for pages that take `params`.
- **Data access is mocked at the module boundary:** `jest.mock("../../lib/okr-api", …)` — presentational components receive data, they do not fetch, so tests drive them by mocking the API client. For `fetch`-based units, assign `global.fetch = jest.fn()` (jsdom does not provide it) and resolve a minimal `{ ok, status, json }` object.
- **Server-action helpers are never invoked in unit tests.** `next/cache` and `next/navigation` are mocked globally in `jest.setup.ts` so importing a page does not drag in the full Next server runtime; `TextEncoder` is polyfilled there for the same reason.
- **jest-dom matcher types** (`toBeInTheDocument`, `toHaveAttribute`) are pulled into the TS program via `src/types/jest-dom.d.ts`, because `jest.setup.ts` lives outside `src` and its augmentation would otherwise be invisible to `tsc`/eslint.
- The 70% coverage floor applies to the whole `apps/web` `src` tree — page/layout server components included — so new pages ship with tests.
