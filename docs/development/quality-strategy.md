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

## Domain unit tests (`packages/core`)

Domain tests run under Jest + ts-jest in the `node` environment, from `@template/jest-config/base`.

- **`better-auth` is ESM-only, so the `test` script needs `--experimental-vm-modules`.** The script is `node --experimental-vm-modules ../../node_modules/jest/bin/jest.js --coverage` — Jest's documented form, and portable to Windows `cmd.exe` unlike an inline `NODE_OPTIONS=` prefix. Without the flag every suite that touches Better Auth fails before a single test runs, with `Must use import to load ES Module`. Run the tests through `npm test`, not bare `npx jest`, and note that anything spawning Jest itself (a Stryker runner, an IDE) does not inherit the flag and must pass it. This is the same workaround the deleted NestJS app needed, for the same reason.
- **Framework-free does not mean dependency-free.** `packages/core` holds no _framework_, which is what ADR-0006 requires and what its ESLint config enforces. It does hold the auth library and the database driver, and those bring their own module-format constraints.

- **`packages/core` is framework-free, and its ESLint config enforces that** — any import of `next/*`, `react`, `react-dom` or `@vercel/*` fails the build, type-level imports included.
- **Collaborators are injected, never reached for.** Anything the domain needs from outside is a port in `src/ports/`, implemented by an adapter in `src/adapters/`, and wired by the composition root. Tests pass a fake in rather than patching a module.
- **Time is injected.** The `Clock` port exists because rules like a Handle's 24-hour hold and 30-day cooldown ([ADR-0004](../adr/0004-the-handle-model.md)) are untestable if the domain reads the system clock.
- `tsconfig.json` declares `"types": ["node", "jest"]`. Without it, type-aware lint rules cannot resolve `expect` and report every assertion as an unsafe call — a failure that looks like a code smell but is a config gap.
- **`tsconfig.json` also includes `drizzle.config.ts`.** A `.ts` file outside the project cannot be parsed by the type-aware linter, and the pre-commit hook lints staged `.ts` files, so a config left out of `include` blocks the commit with a parsing error rather than a real finding.
- **The schema is tested against the library, not against a document.** `schema.test.ts` calls Better Auth's own `getAuthTables()` and asserts our Drizzle tables against it. Its adapter addresses columns by Drizzle **property key**, so a rename is a runtime failure in production rather than a type error at build time; this is the only cheap way to catch that.

## Integration tests (`packages/core`)

Integration tests are named `*.integration.test.ts` and run under `jest.integration.config.mjs`, separate from the unit suite. CI's `integration-tests` job provides a `postgres:16` service and sets `DATABASE_URL`.

- **They never drop a schema or a table.** Resetting the database is how such suites usually start, and it turns a misaimed `DATABASE_URL` into data loss. Drizzle's migrator is idempotent, which is the property worth asserting anyway, so the suite works against a fresh database and an already-migrated one alike.
- **A missing `DATABASE_URL` skips locally but throws in CI.** A green run that tested nothing is worse than a red one, so the suite fails loudly when `CI` is set and no database is configured.
- **The unit suite excludes them** via `testPathIgnorePatterns`, and `collectCoverageFrom` excludes test files — otherwise an integration test that does not run in the unit suite is counted as 0% and drags the package under its coverage threshold.

## Web unit tests (`apps/web`)

Web tests run under Jest + `jest-environment-jsdom` with React Testing Library. Conventions:

- **Async server components** are rendered by awaiting the component function and passing the result to `render` — e.g. `render(await SomePage())`, or `render(await SomePage({ params: Promise.resolve({ id }) }))` for pages that take `params`.
- **Jest cannot parse CSS.** A Next.js layout imports global styles, so `@template/jest-config/nextjs` maps stylesheets to `packages/jest-config/style-mock.js`. Without that mapping a layout test fails at import, before any assertion runs.
- **Data access is mocked at the module boundary:** `jest.mock("../../lib/okr-api", …)` — presentational components receive data, they do not fetch, so tests drive them by mocking the API client. For `fetch`-based units, assign `global.fetch = jest.fn()` (jsdom does not provide it) and resolve a minimal `{ ok, status, json }` object.
- **Server-action helpers are never invoked in unit tests.** `next/cache` and `next/navigation` are mocked globally in `jest.setup.ts` so importing a page does not drag in the full Next server runtime; `TextEncoder` is polyfilled there for the same reason.
- **jest-dom matcher types** (`toBeInTheDocument`, `toHaveAttribute`) are pulled into the TS program via `src/types/jest-dom.d.ts`, because `jest.setup.ts` lives outside `src` and its augmentation would otherwise be invisible to `tsc`/eslint.
- The 70% coverage floor applies to the whole `apps/web` `src` tree — page/layout server components included — so new pages ship with tests.
