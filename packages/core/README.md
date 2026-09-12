# @template/core

The domain. Entities, use cases, and the rules that decide what is allowed.

**This package is framework-free** ([ADR-0006](../../docs/adr/0006-nextjs-on-vercel-is-the-whole-application.md)). It must not import Next.js, React, or Vercel primitives, and `eslint.config.mjs` fails the build if it does. That restriction is what keeps a future NestJS API cheap: a controller there would call the same use cases unchanged.

## `core` versus `shared`

These are different things, and the difference blurs quickly if it is not written down.

| Package            | Holds                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| `@template/core`   | The domain: entities, use cases, ports, and the rules. Decides behaviour.                               |
| `@template/shared` | Values more than one consumer needs: DTO types, wire schemas, constants, i18n messages. Describes data. |

If a change alters what the product _does_, it belongs here. If it alters the _shape of data crossing a boundary_, it belongs in `shared`.

## Dependency injection

No container. Dependencies are constructor-injected and wired by a **manual composition root** (`src/composition-root.ts`), because route handlers and server actions have no container to wire them. See `docs/development/engineering-standards.md` § Layer Boundaries.

Ports live in `src/ports/` as interfaces the domain needs. Adapters implementing them against the real world live in `src/adapters/`, and tests substitute fakes.
