# Coding Standards

<!-- TEMPLATE: These are the standards the agent codes against. Adjust to your
     stack — but keep them concrete. Vague standards produce vague code. -->

## TypeScript & Code Style

- TypeScript strict mode throughout. No `any` — use `unknown` and narrow with type guards where the type is genuinely uncertain.
- ESLint + Prettier enforced via pre-commit hooks. Never disable rules without a comment.
- Conventional Commits format for all commit messages.
- `async/await` throughout — no raw Promise chains or callbacks.
- Use `Promise.all()` for independent async operations; never `await` sequentially when parallelism is safe.
- Always handle Promise rejections — every async call site has a `try/catch` or propagates the error explicitly.
- Use guard clauses (early returns) to avoid nesting. Extract named functions rather than deepening indentation.
- Each function does one thing. Keep functions small and side-effect-free where possible.

---

## Clean Code Principles

### SOLID

| Principle                 | How it applies                                                                                                                                                    |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Single Responsibility** | Each class/module has one reason to change. The API client fetches. The validator checks. The repository persists.                                                |
| **Open/Closed**           | New behaviours are added as new strategies — never by modifying existing code.                                                                                    |
| **Liskov Substitution**   | Repository interfaces are interchangeable — real DB and in-memory test implementations honour the same contract.                                                  |
| **Interface Segregation** | Separate interfaces for separate concerns. No fat multi-purpose services.                                                                                         |
| **Dependency Inversion**  | Use cases depend on repository and client interfaces, not on the database or external SDKs directly. A manual composition root wires them (see Layer Boundaries). |

### Additional Principles

- **SLAP** — Don't mix abstraction levels within a function. High-level orchestration and low-level detail belong in separate functions.
- **DRY** — Extract duplicated logic into shared utilities.
- **Simplicity** — Prefer the simplest solution that satisfies the requirement. Do not over-engineer for hypothetical future needs.

---

## Architecture

### Layer Boundaries

```
Entities <- Use Cases <- Interface Adapters <- Frameworks & Drivers
```

Rules:

- Domain models must never import framework packages. In `packages/core` this is enforced, not merely asked: its ESLint config fails the build on any import of `next/*`, `react`, `react-dom` or `@vercel/*`, including type-level imports.
- Use cases must never reference HTTP status codes or request/response objects.
- All services and repositories are injected via constructors — never instantiated directly.
- Dependencies are wired by a **manual composition root**, not a DI container ([ADR-0006](../adr/0006-nextjs-on-vercel-is-the-whole-application.md) decision 4). Next.js route handlers and server actions have no container to resolve from, so there is nothing for a container to hook into.
- Use strategy patterns for validation pipelines — add new checks as new strategies, not modifications to existing code.

#### The composition root

Anything the domain needs from the outside world is declared as a **port**: an interface in `packages/core/src/ports/`. An **adapter** in `packages/core/src/adapters/` implements it against the real world. The composition root is the single function that constructs the adapters and hands them to the use cases, and it is the only place that does so.

```ts
// packages/core/src/ports/clock.ts — what the domain needs
export interface Clock {
  now(): Date;
}

// packages/core/src/adapters/system-clock.ts — the real implementation
export function createSystemClock(): Clock {
  return { now: () => new Date() };
}

// packages/core/src/composition-root.ts — the only place that wires
export function createCoreServices(deps: CoreDependencies): CoreServices {
  return { clock: deps.clock };
}
```

The transport layer calls it once and passes the result down:

```ts
// apps/web — a route handler stays a thin adapter
const services = createCoreServices({ clock: createSystemClock() });
```

Two rules follow. **Nothing outside the composition root constructs a use case**, so there is one place to look when you need to know what depends on what. And **no module reaches out for a collaborator**, so every test substitutes a fake by passing it in rather than by patching a module.

Time is the clearest example of why this matters. A Handle's hold expires after 24 hours and a released Handle returns after 30 days ([ADR-0004](../adr/0004-the-handle-model.md)); neither rule is testable if the code reads the system clock directly.

---

## Data Patterns

### DTOs and Validation

Define explicit DTO types for all values crossing system boundaries — API requests/responses, third-party payloads. Validate with a schema library (e.g. Zod) at system edges.

### Database Migrations

Every schema change requires a versioned migration file committed in the same PR. No manual DDL. Migrations run in CI and on deployment.

---

## Frontend

### Styling

This project uses **Tailwind CSS v4** (CSS-first, no `tailwind.config.ts` needed). The PostCSS plugin is `@tailwindcss/postcss`. Global styles live in `apps/web/src/app/globals.css`: the `@import "tailwindcss"` directive, two hover-capability variants, `can-hover:` and `no-hover:` ([#252](https://github.com/joshstothard/3moji/issues/252)), a `@theme` block holding the brand tokens ([#251](https://github.com/joshstothard/3moji/issues/251)) and the Handle builder's rare three-of-a-kind animations, `animate-rare-pop` and `animate-rare-hop` ([#202](https://github.com/joshstothard/3moji/issues/202)), and a `@theme inline` block mapping the font utilities to the `next/font` variables.

**Motion is opt-in and brief.** Apply an animation only through the `motion-safe:` variant, so `prefers-reduced-motion: reduce` gets none and a static equivalent carries the meaning; run it once (never `infinite`) and within about a second; and animate `transform` rather than `opacity`, so text rests fully opaque and its contrast can be measured. A CSS animation replays when its element is inserted, so to play one again, remount the element with a `key` rather than toggling a class on a permanent control.

**Hover is a capability, not a given** ([#252](https://github.com/joshstothard/3moji/issues/252)). Tailwind v4 applies `hover:` and `group-hover:` only under `@media (hover: hover)`, so a touch screen never sees them, but `focus-visible:` is not gated. A cue shown on hover and on keyboard focus is therefore written `group-hover:flex can-hover:group-focus-visible:flex`, and a touch screen gets its own always-visible affordance through `no-hover:`. The Handle builder's slot (`components/handle-slot.tsx`) is the model: a coral X and a "Remove <name>" label on hover or focus, a small ink X badge on touch. Show and hide such marks with `hidden` and `flex`, not `opacity`: an invisible element laid over text makes axe report that text's contrast as incomplete, and `measureContrast` refuses reduced opacity.

**Design tokens: the 3moji brand** ([#251](https://github.com/joshstothard/3moji/issues/251)). `@theme` adds these to Tailwind's palette, so each is an ordinary utility. Use them for new UI, not `slate` or `indigo`:

| Token                                               | Value                                                                  | Use                                                                                                                     |
| --------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `paper`                                             | `#FBF8F4`                                                              | Page background (`bg-paper` on `<body>`)                                                                                |
| `card`                                              | `#FFFFFF`                                                              | Cards, fields, pills                                                                                                    |
| `ink`                                               | `#1A1523`                                                              | Headings and primary text, the dark pill (16.87:1 on paper)                                                             |
| `body`                                              | `#4A4453`                                                              | Running text (8.84:1 on paper)                                                                                          |
| `muted`                                             | `#736C7E`                                                              | Secondary text: 4.75:1 on paper, 5.03:1 on white. **Never on `violet-tint`** (4.35:1)                                   |
| `ink-soft`                                          | `#D9D3E3`                                                              | Text on `ink` (12.23:1)                                                                                                 |
| `line`                                              | `#ECE6DD`                                                              | Decorative edges only: card outlines, dividers (1.17:1, identifies nothing)                                             |
| `control`                                           | `#8C8497`                                                              | A border that identifies a control: 3.38:1 on paper, 3.58:1 on white, 3.10:1 on `violet-tint`                           |
| `violet` / `violet-hover` / `violet-tint`           | `#5B3DF5` / `#3F24C9` / `#F0ECFF`                                      | The one accent: primary buttons, links, focus rings. White on violet is 6.12:1                                          |
| `sunshine`                                          | `#FFC53D`                                                              | Rare Handles only (ink on it is 11.32:1)                                                                                |
| `coral`                                             | `#E5484D`                                                              | Remove only: the slot's X and hovered border (3.70:1 on paper, 3.91:1 on white). An icon or edge, never text            |
| `available` / `available-tint` / `available-ink`    | `#1F9D55` / `#E6F6EC` / `#16723F`                                      | The available state (the ink is 5.34:1 on the tint)                                                                     |
| `rounded-slot` / `rounded-card` / `rounded-card-lg` | 24px / 28px / 32px                                                     | Slots and Link rows / cards / large cards. Buttons and pills are `rounded-full`, fields `rounded-2xl` or `rounded-full` |
| `shadow-card`                                       | `0 1px 2px rgb(26 21 35 / .04), 0 16px 32px -16px rgb(26 21 35 / .22)` | The one soft shadow                                                                                                     |
| `tracking-display`                                  | `-0.045em`                                                             | Display headings                                                                                                        |

Two values differ from the design canvas, both for WCAG AA: **muted** is darkened from `#7A7385`, which is 4.29:1 on paper, and **`control`** replaces the canvas's control border `#E4DDD2`, which is 1.27:1 on paper and cannot identify a control under WCAG 1.4.11. `accessibility.spec.ts` measures every control border against 3:1, so a border that identifies a control is `border-control`, never `border-line`.

**Typefaces**, loaded through `next/font/google` in `apps/web/src/app/layout.tsx`, which downloads them at build time and serves them from this origin, so the Content Security Policy's `font-src 'self'` holds and no page asks Google for anything. Each is a CSS variable on `<html>`: **Bricolage Grotesque** (`font-display`, 700/800, tight tracking) for display type, **Geist** (`font-sans`, the default, 400/500/600) for everything you read, and **Geist Mono** (`font-mono`) for URLs.

**No inline styles and no decorative layers behind text.** The production policy refuses a `style` attribute, so a visual effect is a class. And axe works out stacking for itself: a purely decorative element behind text — even `aria-hidden` with `pointer-events: none` — made it report that text's contrast as incomplete, which `accessibility.spec.ts` refuses. That is why the landing page has no radial glow.

### Data Fetching

Prefer server-side data fetching (e.g. Next.js server components). Presentational components receive data as props; they do not fetch.

**Cache revalidation after mutations:** When a server action mutates data, always call `revalidatePath` (or `revalidateTag`) before redirecting. Without it, Next.js serves the cached response and the mutation appears not to have taken effect.

```ts
// server action — correct pattern
await createObjective(dto);
revalidatePath("/objectives"); // bust the cache first
redirect("/objectives"); // then redirect
```

### i18n

Organise translation keys by feature/page namespace, not as a flat file. Never hardcode user-facing strings — all UI text goes through the localisation system. A key added to the default locale must be added to every locale in the same change.

---

## Testing

Refer to [quality-strategy.md](quality-strategy.md) for all testing standards and conventions.

---

## Security

- **OWASP Top 10** compliance required; scanned in CI.
- **Input validation at all system boundaries** — validate API requests and third-party responses before use. Do not trust external input.
- **Parameterised queries only** — never interpolate variables into SQL strings.
- **No secrets in code or committed files** — all config comes from environment variables.
- **The repository is public, so a leak is immediate and permanent.** Bots scan public pushes within seconds, git history cannot be reliably erased, and forks keep what they cloned. The response to a leaked credential is to **rotate it at the source** and then tidy the history — never the other way round, and never tidying alone. Remember that Actions logs, issues and pull requests are public too: GitHub masks values registered as repository secrets in logs, but not a connection string a command happened to print. See `AGENTS.md` § This Repository Is Public.
- **Principle of Least Privilege** — IAM roles, database users, and API scopes get minimum required access.
- **Defence in depth for access control** — auth enforced at multiple independent layers (middleware, service, query). A defect in one layer must not leak data.

---

## Dependency Management

The root `package.json` `overrides` block is the only supported way to force a transitive dependency to a specific version. Four rules keep it trustworthy.

**Verify an override actually applied.** npm will silently reuse an existing `node_modules` tree rather than fail loudly when it cannot resolve a fresh one, and in that state overrides have no effect. A partial clean is not enough — deleting only the lockfile still lets npm hydrate stale versions from disk. To confirm an override took:

```bash
rm -rf node_modules apps/*/node_modules packages/*/node_modules package-lock.json
npm install
npm ls <package>          # every path should show the overridden version
```

**Scope overrides by major version when consumers disagree.** An unscoped override applies tree-wide, including to packages that require an older, API-incompatible major. Use the `name@major` form (e.g. `"picomatch@2"`) so only the intended range is affected. A tree-wide `glob: "10.5.0"` override previously broke `test-exclude`, which needs glob v7's function export — the failure surfaced as an unrelated-looking `promisify` type error during coverage collection.

**An exact-pin override is a snapshot, and it goes stale.** Every entry here pins an exact version, so an override written to _escape_ an advisory silently becomes the thing _holding you on_ the vulnerable version once the next advisory lands. `brace-expansion: "5.0.8"` was the correct fix when written; GHSA-rgw5-rvv9-x895 later moved the fix line to `5.0.9`, and the override was the only reason CI could not resolve a patched copy. When a high-severity advisory names a package that already appears in this block, suspect the override before reaching for the allowlist — the fix is usually a one-line bump, not a new exemption.

Bump to the lowest version that clears the advisory rather than to `latest`, and keep the override inside the range its consumers declare. `fast-uri` is reached only via `ajv@8` (`^3.0.6`), so the correct move has always been a major-scoped `fast-uri@3` — taking 4.x would cross ajv's declared range to buy nothing. That entry is also the worked example of the staleness trap above: it was pinned at `3.1.5` when `3.1.5` was the fix, then four high advisories published 2026-09-02 (GHSA-5jgf-p345-68v8, GHSA-f65p-4m7j-42xc, GHSA-fph4-wmhf-6fwf, GHSA-jqff-g426-hqxp) moved the 3.x fix line to `3.1.6`, and the pin became the sole reason CI could not resolve a patched copy. It broke `main` and five consecutive Nightly Security runs; the fix was a one-character bump to `3.1.6`, not an allowlist entry.

**Peer-range overrides are a last resort, and must be justified.** When a linked tool is genuinely compatible but upstream has not widened its `peerDependencies`, a nested override (e.g. forcing `eslint-plugin-react`'s `eslint` peer to `$eslint`) is acceptable. Prefer bumping to a release with native support where one exists. Never reach for `--legacy-peer-deps` or `--force` to paper over the conflict: an unresolvable tree stops npm re-resolving anything, which quietly freezes every transitive dependency at its current version.

### Audit allowlists

`audit-ci.jsonc` gates CI on high-severity advisories. Before allowlisting anything, confirm the fixed version is genuinely unreachable — `npm audit`'s `range` field is a **union across all advisories** for a package, so it routinely implies no fix exists when one does. Check the individual advisory instead.

Never accept `npm audit fix --force` output unread; it resolves by downgrading, and has proposed dropping `next` from 16.x to 9.3.3.

Every allowlist entry needs a rationale, an expected resolution, and any mitigating controls. Remove entries once upstream ships a fix — audit-ci prints a `Consider not allowlisting` hint when an entry is no longer needed.
