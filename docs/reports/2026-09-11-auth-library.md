# Auth library for owned email-and-password sign-in on Next.js 16

**Type:** Research
**Date:** 2026-09-11
**Author:** Josh Stothard (with Claude)
**Status:** Draft
**Related:** #10 (this research), #8 (3moji MVP map); blocks #15 and #17

## Question

Which auth library should own email-and-password sign-in for 3moji on Next.js 16 / React 19, with the user, session, and password-hash tables in our own Postgres via Drizzle, given that we need email verification as a gate before a Claim is final, password reset in the MVP, and session access inside route handlers and server actions?

## Summary

- **Recommendation: Better Auth, pinned at `better-auth@1.7.4` with `@better-auth/drizzle-adapter@1.7.4`.** It is the only candidate that ships email verification and password reset as first-class endpoints, stores everything (user, session, password hash, verification tokens) in our Postgres via a first-party Drizzle adapter, and declares `next: ^14.0.0 || ^15.0.0 || ^16.0.0` in its peer dependencies [S1, S3, S6, S8].
- **Auth.js (next-auth v5) is not a fit for owned passwords.** It is still a beta (`5.0.0-beta.32`, 2026-07-20) [S2]; its Credentials provider never persists the user and, when Credentials is the only provider, `@auth/core` throws `Signing in with credentials only supported if JWT strategy is enabled` [S13, S14]. There are no password-reset or verification endpoints; the docs tell you to "provide the necessary logic" yourself [S11]. There is also an open Next.js 16 bug in the `signIn` server action [S22].
- **A hand-rolled Lucia-style module is the named fallback.** Lucia the library was deprecated in March 2025; what remains is a guide plus a single-file `auth_session.ts` reference implementation and the Auth Book [S15, S16, S17]. It gives full control with zero third-party auth code, at the cost of writing and testing sign-up, verification, reset, hashing, rate limiting, and CSRF ourselves.
- **Verification and reset story with Better Auth:** we supply two functions, `emailVerification.sendVerificationEmail` and `emailAndPassword.sendResetPassword`; Better Auth creates the token, stores it in its `verification` table, exposes `/verify-email`, `/request-password-reset`, and `/reset-password`, flips `user.emailVerified`, and can revoke sessions on reset. The "verified" gate for a Claim is just `user.emailVerified === true` on the row in our own DB [S3, S4, S5, S9, S10].
- **Next.js 16 caveats** (all libraries): `middleware.ts` is deprecated in favour of `proxy.ts`, which runs only on the Node.js runtime; `cookies()`/`headers()` are async-only; and server actions cannot set cookies unless the library bridges them (Better Auth's `nextCookies()` plugin) [S6, S19, S20].

## Background

3moji is a Next.js-only app on Vercel: route handlers and server actions are the backend (no NestJS), Drizzle ORM talks to Postgres, and sign-in is email-and-password only. The domain rule that drives this question is that an **Account** (email + password) claims a **Handle**, and a claim is not final until the account's email is verified. Password reset is in the MVP.

The repo currently pins `next` at `16.3.4` in `package-lock.json` (`apps/web/package.json` declares `^16.3.1`) and `react` at `19.2.8`; `drizzle-orm@0.45.2` is the current npm release [S1, S2]. The ticket (#10) asked for Better Auth, Auth.js (next-auth v5) with the Credentials provider, and a hand-rolled Lucia-style sessions module to be compared from primary sources. The map is #8.

## Findings

### Finding 1: Version support for Next.js 16 (from `npm view`, 2026-09-11)

| Package                         | Pinned version    | Published   | `next` peer range                       | `drizzle-orm` peer range                |
| ------------------------------- | ----------------- | ----------- | --------------------------------------- | --------------------------------------- |
| `better-auth`                   | `1.7.4` (latest)  | 2026-09-10  | `^14.0.0 \|\| ^15.0.0 \|\| ^16.0.0`     | `^0.45.2 \|\| >=1.0.0-rc.1 <2.0.0`      |
| `@better-auth/drizzle-adapter`  | `1.7.4`           | 2026-09-10  | n/a                                     | `^0.45.2 \|\| >=1.0.0-rc.1 <2.0.0`      |
| `next-auth`                     | `5.0.0-beta.32` (`beta` tag) | 2026-07-20 | `^14.0.0-0 \|\| ^15.0.0 \|\| ^16.0.0` | n/a (adapter is separate)          |
| `@auth/drizzle-adapter`         | `1.11.3`          | 2026-07-20  | n/a                                     | none declared (only `@auth/core@0.41.3` as a dependency) |
| `next-auth` (`latest` tag)      | `4.24.15`         | 2026-07-20  | `^12.2.5 \|\| ^13 \|\| ^14 \|\| ^15 \|\| ^16` | n/a                              |
| `lucia`                         | `3.2.2`           | deprecated  | n/a                                     | n/a                                     |

Sources: [S1], [S2]. All three candidates that are still published declare the repo's Next.js major. The `latest` dist-tag for `next-auth` is still v4; v5 has been a beta since 2024 (`5.0.0-beta.25` was 2024-10-19) and the docs still install it as `next-auth@beta` [S2, S12]. Better Auth's minor cadence has been roughly quarterly (1.4.0 2025-11-22, 1.5.0 2026-03-01, 1.6.0 2026-04-06, 1.7.0 2026-08-18) [S2]. Both Better Auth (#6439, closed 2025-12-02) and Auth.js (#13302, closed 2025-10-29) had a peer-dependency block on Next.js 16 at its release that is now closed [S21].

Repository health at 2026-09-11 (GitHub API): `better-auth/better-auth` 29,907 stars, 722 open issues, MIT, last push 2026-09-11; `nextauthjs/next-auth` 28,367 stars, 603 open issues, ISC, last push 2026-07-22; `lucia-auth/lucia` 10,447 stars, MIT, not archived, last push 2026-08-08 [S18].

### Finding 2: Tables each option creates

**Better Auth** creates four core tables: `user`, `session`, `account`, `verification` [S3].

| Table          | Fields (required unless noted)                                                                                                                                                                      |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user`         | `id`, `name`, `email` (unique), `emailVerified` (boolean), `image` (optional), `createdAt`, `updatedAt`                                                                                             |
| `session`      | `id`, `userId` (FK, cascade delete, indexed), `token` (unique), `expiresAt`, `ipAddress` (opt), `userAgent` (opt), `createdAt`, `updatedAt`                                                         |
| `account`      | `id`, `userId` (FK), `accountId`, `providerId`, `accessToken`/`refreshToken`/`accessTokenExpiresAt`/`refreshTokenExpiresAt`/`scope`/`idToken` (all opt), **`password` (opt)**, `createdAt`, `updatedAt` |
| `verification` | `id`, `identifier` (indexed), `value`, `expiresAt`, `createdAt`, `updatedAt`                                                                                                                        |

The password hash lives in `account.password` (one `account` row per auth method, `providerId = "credential"` for email/password). Table and column names are customisable via `modelName` and `fields`; ID generation defaults to library-generated strings and can be switched to `"uuid"` or `"serial"` [S3]. Password-reset and email-verification tokens live in `verification` [S9, S10]. The `session` table `token` column is what the session cookie carries [S7].

**Auth.js** with `@auth/drizzle-adapter` expects `users`, `accounts`, `sessions` (only for the database session strategy), `verificationTokens` (only for magic-link Email providers), and `authenticators` (WebAuthn) [S12b]. There is **no password column**: the Credentials provider "does not persist data in the database" [S11], so a password-hash column would be our own addition to `users`, written by our own sign-up code.

**Hand-rolled (Lucia-style)** creates whatever we define. The reference `auth_session.ts` assumes one `auth_session` table with `id`, `user_id`, `secret_hash` (SHA-256 of the secret, binary), `token_last_verified_at`, `created_at` [S17]. We would add `user` (with `email`, `email_verified`, `password_hash`) and a token table for verification and reset.

### Finding 3: Drizzle adapter maturity

- **Better Auth:** first-party, versioned in lockstep (`@better-auth/drizzle-adapter@1.7.4` depends on `@better-auth/core@^1.7.4`), supports `provider: "pg"`, `usePlural`, `schemaName`, Drizzle relations v1 and v2 (`@better-auth/drizzle-adapter/relations-v2`), and the adapter had "improved schema validation" in 1.7.4 [S1, S8, S8b]. Schema is produced by `npx auth@latest generate` and migrated by our own `drizzle-kit generate` / `drizzle-kit migrate`, so migrations stay in our repo per Absolute Rule 4 [S3, S8]. Caveat: relations must be passed through the adapter's `schema` object, and tables with two FKs to the same table need matching `relationName` on both sides [S8].
- **Auth.js:** `@auth/drizzle-adapter@1.11.3` is first-party but only wires the adapter interface (`createUser`, `getUserByEmail`, `createSession`, `createVerificationToken`, ...) [S12b, S12c]. Since Credentials sign-in never calls `createUser` [S13], the adapter would only ever be used by our own code, which makes it mostly dead weight for this product.
- **Hand-rolled:** we write the Drizzle queries directly; there is nothing to mature.

### Finding 4: Email verification and password reset

**Better Auth** (we send the email; it does everything else):

- Verification: configure `emailVerification.sendVerificationEmail({ user, url, token }, request)`; with `sendOnSignUp: true` or `emailAndPassword.requireEmailVerification: true` the sign-up route creates a JWT token and calls our sender with `${baseURL}/verify-email?token=...&callbackURL=...` [S4, S5, S9, S10b]. `GET /verify-email` sets `user.emailVerified = true` and, with `autoSignInAfterVerification: true`, creates a session [S9]. Token default expiry is 3600 s [S9, S5b]. Hooks: `beforeEmailVerification`, `afterEmailVerification` [S5]. With `requireEmailVerification: true`, sign-up returns `token: null` (no session) and sign-in returns 403 until verified; duplicate sign-ups return a synthetic success to avoid enumeration [S5, S10b].
- Reset: configure `emailAndPassword.sendResetPassword({ user, url, token }, request)`; `POST /request-password-reset` generates a 24-char random token stored in `verification` as `reset-password:<token>` with a 1-hour default expiry, simulating work when the user does not exist to defeat timing attacks; `POST /reset-password` consumes the token single-use ("the first caller wins") and, with `revokeSessionsOnPasswordReset: true`, deletes the user's sessions [S4, S10]. `onPasswordReset` hook is available [S4].
- The "verified" gate for a Claim is a read of `user.emailVerified` on our own row. That is consistent with the Copenhagen Book's guidance that reset tokens be single-use, ~1 hour, and hashed or otherwise protected, and that sessions be invalidated after a reset [S23, S24].

**Auth.js:** no verification or reset endpoints exist for Credentials. The docs say the provider is for authenticating "against an existing system" and that the developer must "provide the necessary logic", and explicitly list "password management (password reset, credential stuffing, rotation)" as something OAuth providers do for you [S11]. `emailVerified` on `AdapterUser` records "whether the user has verified their email address via an Email provider" (magic link), not a password-account verification [S12c]. We would build both flows ourselves and only reuse Auth.js for the session cookie.

**Hand-rolled:** we build both flows. The Auth Book (free, by Lucia's author) has chapters on password auth, email verification, and password reset [S16]; the Copenhagen Book gives the parameters: 8-digit numeric or 6-char alphanumeric codes, 15 min to 24 h validity, single-use, ~10 attempts per hour, invalidate sessions on verification and reset, strict rate limiting on any email-sending endpoint [S23, S24].

### Finding 5: Session access in route handlers and server actions

- **Better Auth:** mount `export const { GET, POST } = toNextJsHandler(auth)` in `app/api/auth/[...all]/route.ts`; read the session anywhere on the server with `auth.api.getSession({ headers: await headers() })`. Server actions cannot set cookies directly, so the `nextCookies()` plugin is required: it turns any `Set-Cookie` header produced by `auth.api.signInEmail`/`signUpEmail` into a `cookies().set` call [S6]. Sessions are database rows (7-day expiry, refreshed after `updateAge` of 1 day) with an optional signed `cookieCache`; `revokeSessions`/`revokeOtherSessions` exist [S7, S5b].
- **Auth.js v5:** one `auth()` function works in server components, route handlers (`auth(req, res)`), server actions, and `proxy.ts` (`export { auth as proxy }`) [S12]. With Credentials-only, sessions are JWTs in a cookie, not rows — Auth.js itself notes that "Expiring a JSON Web Token before its encoded expiry is not possible" without a server-side blocklist [S12d], so "sign out everywhere after password reset" would need our own denylist.
- **Hand-rolled:** `cookies()` from `next/headers` in server actions and route handlers, per the Next.js auth guide, which recommends a Data Access Layer with a `cache()`-wrapped `verifySession()` and warns that layouts do not re-run on navigation [S19].

### Finding 6: Password hashing defaults

- **Better Auth:** scrypt by default ("Better Auth uses `scrypt` to hash passwords"), implemented in `@better-auth/utils/password`, which picks `node:crypto` scrypt on Node and `@noble/hashes` as a fallback; `password.hash`/`password.verify` accept a replacement (the docs show Argon2) [S4, S9b, S5b]. The exact scrypt cost parameters live in `@better-auth/utils` and were not read (unverified).
- **Auth.js:** none. The Next.js guide's own example uses `bcrypt.hash(password, 10)` [S19]; Auth.js leaves hashing to `authorize()` [S11].
- **Hand-rolled:** our choice. The Copenhagen Book orders Argon2id (min 19 MiB, 2 iterations, parallelism 1) > scrypt (N 16384, r 16, p 1, dkLen 64) > bcrypt (cost >= 10, 72-byte input cap) [S25]. `@node-rs/argon2@2.2.1` (2026-09-10) is the current native binding [S1].

### Finding 7: Next.js 16 caveats

Framework-level (apply to all options) [S19, S20, S20b]:

- `middleware.ts` is deprecated and renamed `proxy.ts` (v16.0.0); proxy runs only on the Node.js runtime and the `runtime` config throws. The Next.js docs say to keep proxy checks cookie-only (optimistic) and do real checks in a DAL; server actions are POSTs to the page route, so a proxy matcher that excludes a path silently excludes its actions.
- `cookies()`, `headers()`, `params`, `searchParams` are async-only.
- With Cache Components enabled, reading the session inside a `"use cache"` scope is not allowed (Better Auth #5584 hit this; closed 2026-02-02) [S21].
- Node 20.9+, TypeScript 5.1+.

Library-specific:

- **Better Auth:** the Next.js integration doc has explicit "Next.js 16+ (Proxy)" guidance (Node runtime, so `auth.api.getSession` works in proxy; `getSessionCookie` for optimistic redirects) [S6]. Next.js 16 issues found were all closed: peer-dep block #6439 (closed 2025-12-02), `use cache` + session #5584 (closed 2026-02-02), OAuth double-callback #5658 (closed 2026-02-23, OAuth-only so out of scope) [S21].
- **Auth.js:** #13388 "signIn server action fails with Configuration error on Next.js 16" (opened 2026-03-01, `next-auth@5.0.0-beta.30`, `next@16.1.6`) is still **open** with a traced root cause in `next-auth/lib/actions.js` (`x-forwarded-proto` handling); the HTTP handlers work but the documented server-action login path does not [S22]. beta.32 release notes do not mention it [S2b].
- **Hand-rolled:** none beyond the framework list; the reference file recommends `Sec-Fetch-Site` CSRF checks on non-GET requests, which Next.js server actions already enforce via origin checks (unverified for the route-handler path) [S17].

## Options

| Option                                                          | Pros                                                                                                                                                                                  | Cons                                                                                                                                                                                     | Effort | Risk   |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------ |
| A. Better Auth `1.7.4` + `@better-auth/drizzle-adapter` `1.7.4` | Declares Next 16; first-party Drizzle adapter; verification, reset, DB sessions, enumeration and timing protections built in; `emailVerified` column in our Postgres is the Claim gate | Four tables with library-shaped names; adds `better-auth`, `kysely`, `jose`, `zod` to the bundle; 722 open issues in a fast-moving project; scrypt not Argon2id by default               | Low    | Low    |
| B. Auth.js `5.0.0-beta.32` + Credentials + `@auth/drizzle-adapter` | Familiar `auth()` API; declares Next 16                                                                                                                                            | Beta for ~2 years; Credentials forces JWT sessions and never writes users; no reset or verification for passwords; open Next 16 `signIn` action bug; adapter unused by the login flow     | Medium | High   |
| C. Hand-rolled Lucia-style module                               | Zero third-party auth code; exact schema we want; Argon2id from day one; smallest dependency surface                                                                                  | We own sign-up, verification, reset, hashing, rate limiting, CSRF, and their tests; Lucia is deprecated so no upstream fixes; more surface for OWASP review                              | High   | Medium |

## Recommendation

Adopt **Option A: Better Auth pinned at `better-auth@1.7.4` and `@better-auth/drizzle-adapter@1.7.4`**, configured with `emailAndPassword.enabled`, `requireEmailVerification: true`, `sendVerificationEmail` and `sendResetPassword` wired to the transactional email provider chosen by #11, `revokeSessionsOnPasswordReset: true`, the `nextCookies()` plugin, and `drizzleAdapter(db, { provider: "pg" })` with the schema committed via `npx auth@latest generate` followed by `drizzle-kit generate` (so the migration lands in the same PR as the schema). The Claim gate is `user.emailVerified` read from our own `user` row inside the claim server action. Consider overriding `password.hash`/`verify` with `@node-rs/argon2` to follow the Copenhagen Book ordering; that is an option, not a blocker.

**Fallback: Option C, a hand-rolled Lucia-style module** built from `auth_session.ts` and the Auth Book, if Better Auth turns out to fight the domain model (for example if `account`/`user` shapes clash with Account/Handle) or if a Next.js 16 regression lands that upstream is slow to fix. Auth.js v5 is not recommended for this product: it is still beta, Credentials is JWT-only and non-persisting, and the login server action is currently broken on Next.js 16.

Confidence: high on the ranking, medium on the exact configuration until a spike runs the sign-up -> verify -> claim -> reset path against Postgres. What would change the recommendation: Auth.js shipping a stable v5 with a database-backed Credentials flow, or Better Auth's Next 16 support regressing in a 1.8 release.

## Next steps

- **ADRs to write:** "Better Auth owns email-and-password auth for 3moji" (the `adr` skill) once #8 accepts this report
- **Workstreams to open:** none yet; the auth phase belongs to the MVP workstream that #8 will produce
- **Issues to file:** spike "Better Auth 1.7.4 + Drizzle: sign-up, verify, claim, reset end to end" (the `capture` skill); unblocks #15 and #17

## Sources

1. [S1] `npm view better-auth version peerDependencies dependencies`, `npm view @better-auth/drizzle-adapter@1.7.4 peerDependencies`, `npm view next-auth@5.0.0-beta.32 peerDependencies dependencies`, `npm view next-auth version peerDependencies dist-tags`, `npm view @auth/drizzle-adapter@1.11.3 peerDependencies dependencies`, `npm view drizzle-orm version`, `npm view next version`, `npm view @node-rs/argon2 version`, `npm view lucia version deprecated`; run 2026-09-11. Repo pins from `package-lock.json` (`next@16.3.4`, `react@19.2.8`) and `apps/web/package.json` (`next@^16.3.1`).
2. [S2] `npm view <pkg> time --json` for `better-auth` (1.4.0 2025-11-22, 1.5.0 2026-03-01, 1.6.0 2026-04-06, 1.7.0 2026-08-18, 1.7.4 2026-09-10), `next-auth` (5.0.0-beta.25 2024-10-19, beta.30 2025-10-27, beta.31 2026-04-14, beta.32 2026-07-20), `next` (16.0.0 2025-10-22, 16.3.4 2026-08-31); run 2026-09-11. [S2b] https://github.com/nextauthjs/next-auth/releases/tag/next-auth%405.0.0-beta.32 (accessed 2026-09-11).
3. [S3] https://raw.githubusercontent.com/better-auth/better-auth/main/docs/content/docs/concepts/database.mdx and https://www.better-auth.com/docs/concepts/database (core schema, CLI `generate`/`migrate`, `generateId`, `modelName`/`fields`; accessed 2026-09-11).
4. [S4] https://www.better-auth.com/docs/authentication/email-password and its source https://raw.githubusercontent.com/better-auth/better-auth/main/docs/content/docs/authentication/email-password.mdx (scrypt default, `sendResetPassword`, `resetPasswordTokenExpiresIn` 3600 s, `revokeSessionsOnPasswordReset`, `password.hash`/`verify`; accessed 2026-09-11).
5. [S5] https://www.better-auth.com/docs/concepts/email and https://raw.githubusercontent.com/better-auth/better-auth/main/docs/content/docs/concepts/email.mdx (`sendVerificationEmail`, `sendOnSignUp`, `sendOnSignIn`, `autoSignInAfterVerification`, `beforeEmailVerification`, `afterEmailVerification`, 403 on unverified sign-in; accessed 2026-09-11). [S5b] https://raw.githubusercontent.com/better-auth/better-auth/main/packages/core/src/types/init-options.ts (defaults: `emailVerification.expiresIn` 3600 s, `resetPasswordTokenExpiresIn` 1 h, `session.expiresIn` 7 d, `session.updateAge` 1 d; "By default Scrypt is used"; accessed 2026-09-11).
6. [S6] https://www.better-auth.com/docs/integrations/next and https://raw.githubusercontent.com/better-auth/better-auth/main/docs/content/docs/integrations/next.mdx (`toNextJsHandler`, `nextCookies()`, `auth.api.getSession({ headers: await headers() })`, "Next.js 16+ (Proxy)" section, `getSessionCookie`; accessed 2026-09-11).
7. [S7] https://raw.githubusercontent.com/better-auth/better-auth/main/docs/content/docs/concepts/session-management.mdx (7-day expiry, `updateAge`, `cookieCache`, `revokeSessions`, `revokeOtherSessions`; accessed 2026-09-11).
8. [S8] https://raw.githubusercontent.com/better-auth/better-auth/main/docs/content/docs/adapters/drizzle.mdx (import from `@better-auth/drizzle-adapter`, `provider: "pg"`, `npx auth@latest generate` then `drizzle-kit generate`/`migrate`, relations v1/v2, `relationName` caveat; accessed 2026-09-11). [S8b] https://github.com/better-auth/better-auth/releases/tag/v1.7.4 (published 2026-09-10 per GitHub API; Drizzle adapter schema-validation fix; accessed 2026-09-11).
9. [S9] https://raw.githubusercontent.com/better-auth/better-auth/main/packages/better-auth/src/api/routes/email-verification.ts (JWT token, default 3600 s, `/send-verification-email`, `GET /verify-email`, sets `emailVerified: true`, `autoSignInAfterVerification` creates a session; accessed 2026-09-11). [S9b] https://raw.githubusercontent.com/better-auth/better-auth/main/packages/better-auth/src/crypto/password.ts (re-exports `@better-auth/utils/password`; node:crypto scrypt with `@noble/hashes` fallback; accessed 2026-09-11).
10. [S10] https://raw.githubusercontent.com/better-auth/better-auth/main/packages/better-auth/src/api/routes/password.ts (`/request-password-reset`, `GET /reset-password/:token`, `POST /reset-password`, `generateId(24)`, identifier `reset-password:<token>`, default 1 h, `consumeVerificationValue` single-use, `deleteUserSessions` on `revokeSessionsOnPasswordReset`, timing-attack simulation; accessed 2026-09-11). [S10b] https://raw.githubusercontent.com/better-auth/better-auth/main/packages/better-auth/src/api/routes/sign-up.ts (verification email on sign-up, `token: null` when `requireEmailVerification`, synthetic duplicate response; accessed 2026-09-11).
11. [S11] https://authjs.dev/getting-started/authentication/credentials and https://authjs.dev/getting-started/providers/credentials ("does not persist data in the database", "provide the necessary logic", OAuth providers handle "password management (password reset, credential stuffing, rotation)"; accessed 2026-09-11).
12. [S12] https://authjs.dev/getting-started/migrating-to-v5 (`npm install next-auth@beta`, universal `auth()`, `export { auth as proxy }`, minimum Next.js 14; accessed 2026-09-11). [S12b] https://authjs.dev/getting-started/adapters/drizzle (tables `users`, `accounts`, `sessions`, `verificationTokens`, `authenticators`; accessed 2026-09-11). [S12c] https://authjs.dev/reference/core/adapters (adapter methods, `emailVerified` semantics; accessed 2026-09-11). [S12d] https://authjs.dev/concepts/session-strategies (JWT default, cannot expire JWT early; accessed 2026-09-11).
13. [S13] https://raw.githubusercontent.com/nextauthjs/next-auth/main/packages/core/src/lib/actions/callback/index.ts (credentials branch: `authorize()` result gets `crypto.randomUUID()` id, encoded into a JWT, never written to the adapter; accessed 2026-09-11).
14. [S14] https://raw.githubusercontent.com/nextauthjs/next-auth/main/packages/core/src/lib/utils/assert.ts (`UnsupportedStrategy`: "Signing in with credentials only supported if JWT strategy is enabled"; accessed 2026-09-11).
15. [S15] https://lucia-auth.com/ ("Lucia was deprecated in March 2025. This website was updated in July 2026"; links to the Auth Book and `code/auth_session.ts`; accessed 2026-09-11). `npm view lucia deprecated` -> "This package has been deprecated. Please see https://lucia-auth.com/lucia-v3/migrate."
16. [S16] https://auth.pilcrowonpaper.com/ (the Auth Book: free guides on sessions, password auth, email verification, password reset; accessed 2026-09-11).
17. [S17] https://raw.githubusercontent.com/lucia-auth/lucia/refs/heads/main/code/auth_session.ts (`auth_session` columns, 16-byte id + 32-byte secret, SHA-256 secret hash, 10-day expiry with hourly refresh, cookie attributes, `Sec-Fetch-Site` CSRF note; accessed 2026-09-11).
18. [S18] `gh api repos/better-auth/better-auth`, `gh api repos/nextauthjs/next-auth`, `gh api repos/lucia-auth/lucia`, `gh api repos/better-auth/better-auth/releases/latest`; run 2026-09-11.
19. [S19] https://nextjs.org/docs/app/guides/authentication (v16.3.5 docs, lastUpdated 2026-08-25: DAL pattern, `cookies()` in actions/handlers, proxy is Node runtime and optimistic-only, layouts do not re-check, auth library list; accessed 2026-09-11).
20. [S20] https://nextjs.org/docs/app/api-reference/file-conventions/proxy (Node.js runtime only, `runtime` config throws, v16.0.0 rename, server actions are POSTs on the page route; accessed 2026-09-11). [S20b] https://nextjs.org/docs/app/guides/upgrading/version-16 and https://nextjs.org/blog/next-16 (published 2025-10-21: async request APIs enforced, `edge` not supported in proxy, Node 20.9+, TS 5.1+; accessed 2026-09-11).
21. [S21] `gh api repos/better-auth/better-auth/issues/{6439,5584,5658}` and `gh api repos/nextauthjs/next-auth/issues/13302` (states and close dates as quoted; run 2026-09-11). Found via WebSearch `better-auth "Next.js 16" site:github.com/better-auth/better-auth` and `next-auth v5 beta "Next.js 16" site:github.com/nextauthjs/next-auth`.
22. [S22] https://github.com/nextauthjs/next-auth/issues/13388 (open; `signIn` server action returns `?error=Configuration` on Next.js 16; reporter traced to `x-forwarded-proto` handling in `next-auth/lib/actions.js`; read via `gh api` 2026-09-11).
23. [S23] https://thecopenhagenbook.com/password-reset (hash tokens with SHA-256, ~1 h validity, single-use, invalidate sessions after reset, rate-limit email-sending endpoints; accessed 2026-09-11).
24. [S24] https://thecopenhagenbook.com/email-verification (8-digit numeric / 6-char alphanumeric codes, 15 min to 24 h validity, single-use, ~10 attempts per hour, invalidate sessions on verification; accessed 2026-09-11).
25. [S25] https://thecopenhagenbook.com/password-authentication (Argon2id > scrypt > bcrypt, with minimum parameters; accessed 2026-09-11).
