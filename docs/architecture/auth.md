# Authentication

**Built, not yet deployed.** The tables, the auth instance, the HTTP routes and the verification flow all exist; nothing is running against a real database until #32 provisions one. The shape is decided in [ADR-0006](../adr/0006-nextjs-on-vercel-is-the-whole-application.md).

## Where each piece lives

| Piece                               | Lives in                                                                   |
| ----------------------------------- | -------------------------------------------------------------------------- |
| The auth instance and its settings  | `packages/core/src/auth/create-auth.ts`                                    |
| The email port and its two adapters | `packages/core/src/auth/ports/`, `packages/core/src/auth/adapters/`        |
| The wiring                          | `apps/web/src/lib/services.ts`, the only module that reads the environment |
| The HTTP surface                    | `apps/web/src/app/api/auth/[...all]/route.ts`                              |
| The verification landing            | `apps/web/src/app/claim/verify/route.ts`                                   |
| The hold screen and resend          | `apps/web/src/app/claim/held/`, `src/components/hold-screen.tsx`           |
| Reading the session                 | `apps/web/src/lib/session.ts`, the one place an identity enters the app    |

**The Next.js cookie plugin is the boundary's one interesting case.** It comes from `better-auth/next-js`, which `packages/core` may not import, so `createAuth` accepts plugins from its caller and `apps/web` passes it in. The boundary holds without giving up the plugin.

**Services are built on first request, not at module scope.** `next build` imports route handlers, and the factories throw on a missing secret or connection string, so eager construction would fail the build on any machine without a full environment — including CI. Deferring keeps the build honest while still failing loudly when a request needs a misconfigured service.

## Shape

Email and password only. No social login. **Better Auth** owns sign-in, sessions, verification, and password reset, with every table in our own Postgres via its Drizzle adapter. Owning the tables is the whole reason this is not a hosted auth service: it is what keeps the data portable.

Sessions are database rows, not stateless tokens, so revoking one actually revokes it.

## Configuration that carries meaning

Three settings are load-bearing for the product, not defaults to be changed casually:

| Setting                         | Effect                                                                                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `requireEmailVerification`      | Sign-up returns no session, and sign-in returns 403 until verified. This is what makes the verification gate real rather than advisory.                                  |
| `autoSignInAfterVerification`   | **Not a default.** Without it, following the verification link verifies the account and then drops the user at a sign-in page, instead of the Profile they just claimed. |
| `revokeSessionsOnPasswordReset` | A reset destroys every existing session.                                                                                                                                 |

## Sign-up on the claim path

Sign-up is not reached on its own: it happens inside the Claim's transaction, because an Account and its Handle are one atomic act (ADR-0004 decision 4). The only form that reaches it is the claim form the builder offers for an available Handle ([system-overview.md](system-overview.md) § The claim form). The Claim constructs an auth instance bound to that transaction and wraps the email sender so the verification email is held until the commit — see [the Claim](data-model.md#the-claim) for the shape and for the constraint that the production driver has no interactive transactions.

### Sign-up is refused over HTTP

**The Claim is the only way an Account is created, and that is enforced, not just true of the UI** ([#150](https://github.com/joshstothard/3moji/issues/150)). Better Auth serves `POST /api/auth/sign-up/email` through the catch-all route, and before #150 a direct request to it — measured against Postgres in `direct-sign-up.integration.test.ts` — created an Account with **no Handle** and sent a verification email, from an endpoint nothing limits. That is the handle-less state ADR-0004 decision 4 forbids.

`createAuth` now sets Better Auth's `disabledPaths` to `/sign-up/email` and `/sign-in/social`, and both answer a plain `404 Not Found` over HTTP.

**Why `disabledPaths` and not `emailAndPassword.disableSignUp`, measured rather than assumed:**

| Option                           | Where better-auth 1.7.4 checks it                            | Refuses HTTP sign-up | Refuses the Claim's server-side `auth.api.signUpEmail` |
| -------------------------------- | ------------------------------------------------------------ | -------------------- | ------------------------------------------------------ |
| `emailAndPassword.disableSignUp` | Inside the endpoint's own body                               | Yes                  | **Yes** — throws `EMAIL_PASSWORD_SIGN_UP_DISABLED`     |
| `disabledPaths`                  | The router's `onRequest`, which only an HTTP request reaches | Yes                  | No                                                     |

So `disableSignUp` would take the Claim down with the bypass, and blocking the path in the Next.js route handler would put a security rule in a transport adapter that no integration test can reach. `disabledPaths` lives in `packages/core`, beside the rest of the auth settings.

**The refusal cannot enumerate addresses.** It is decided on the path alone, before the body is parsed or the database is read, so a registered address, an unregistered one and a request with no address at all get the same status, the same body and — because no address-dependent work runs — the same timing. That is stronger than padding to `RESPONSE_FLOOR_MS`, which exists for answers that _do_ depend on an address.

**Which endpoints can create an Account.** In better-auth 1.7.4 `internalAdapter.createUser` has exactly two callers: email sign-up, and `handleOAuthUserInfo`, reached from `/sign-in/social` and `/callback/:id`. No social provider is configured, so the OAuth paths cannot create an Account today; `/sign-in/social` is disabled anyway, so the first provider added does not quietly reopen the bypass. `/callback/:id` cannot be listed — `disabledPaths` matches the exact path — and needs OAuth state issued by `/sign-in/social` or by `/link-social`, which requires a signed-in Account. **Recheck the list on every Better Auth upgrade and every plugin added**: a plugin such as magic link, email OTP or anonymous sign-in brings its own Account-creating endpoints.

Two consequences for anyone touching the settings above. Because the verification email is sent from inside sign-up, **anything that sends mail during a transaction has to be buffered** the same way, or a rolled-back write sends a message about something that did not happen. And because Better Auth returns a synthetic success for an already-registered address, **its response cannot be used to decide whether the address exists** — the Claim reads the `user` row inside its transaction instead.

**Email addresses are compared in one form: trimmed and lowercased** ([#163](https://github.com/joshstothard/3moji/issues/163)). That is Better Auth's form — its sign-up stores `email.toLowerCase()`, and its sign-in, change-email and user lookup all search by it — so it is the only form that agrees with the library about which Account an address names. The Claim normalises the address **once, at its domain input** (`claimHandle`, through `normaliseEmailAddress` in `packages/core/src/auth/email-address.ts`, which is deliberately not exported to transports), and everything after that compares exactly: the claim adapter's reads of `user.email` use the column's unique index, and the collision notice looks up the address the Claim reports it used rather than normalising again. Before this, a Claim typed as `Someone@Example.com` failed outright while `someone@example.com` reached the hold screen — a difference that revealed which addresses were registered. The Account directory's `lower(email) = lower(?)` stays: it serves sign-in and resend, whose transports hand it the address as typed, and it is the same agreement with Better Auth expressed in SQL. Every `user` row is written by Better Auth's own sign-up, which lowercases first, so no Account with a non-lowercase address can exist; nothing in the schema enforces that, and a functional unique index on `lower(email)` is the change to make if anything but Better Auth ever writes the table.

## The gate on claiming

A Claim is final only once the Account's email is verified. The gate is a read of the verified flag on our own row — and finalising writes `handle.claimed_at` in the **same transaction** as that flag, because `claimed_at` is what ownership means. See [Finalising the Claim](data-model.md#finalising-the-claim).

The verification token expires in an hour while the Handle's hold lasts a day, so **resending is the ordinary path, not an edge case**. The expired-link page must make clear the Handle is still held — and it can, because it knows which Handle: see the next section for why the link does not go to Better Auth's own endpoint.

### The verification link points at our own route, not Better Auth's

Better Auth builds `{baseURL}/api/auth/verify-email?token=…` and hands it to the `sendVerificationEmail` hook. **That URL is deliberately not the one we send.** The hook rewrites it to `{baseURL}/claim/verify?token=…`, and the token still travels as a query parameter, matching the shape the library uses.

Two reasons, and only a real run makes either visible:

1. **Invalidation needs an interception point.** The verification token is a signed JWT the library never stores, so a resend cannot delete anything and every link it has issued stays valid for its hour. "Only the newest link works" has to be enforced _before_ verification, against our own record of what we issued ([verification dispatch](data-model.md#verification-dispatch)) — and nothing can run before an endpoint the library owns.
2. **Its failure mode throws the token away.** Given a `callbackURL`, a rejected token becomes a redirect carrying `?error=token_expired` and nothing else, so the expired-link page could not say _which_ Handle is still held. Given none, a rejection is a bare 401 with no page at all.

It is a **route handler** rather than a page because signing somebody in means setting a cookie, and in the App Router only a route handler or a server action may. It forwards Better Auth's `Set-Cookie` headers onto a 303 — with `getSetCookie()`, because `get("set-cookie")` folds several into one comma-joined string no browser will parse back apart. Dropping them would verify the address and sign nobody in, silently, with `autoSignInAfterVerification` on and doing nothing.

**Note the two link shapes differ.** Verification puts its token in a query parameter; password reset puts its token in a **path segment** (`/reset-password/<token>?callbackURL=…`). A helper that handles only the query form passes every verification test and fails every reset test — see `quality-strategy.md`.

### Resend, and its limits

`resendVerification` (`packages/core/src/auth/resend-verification.ts`) is the whole rule; the server action over it decides nothing. Three steps, in this order: resolve the address to an Account (the limit is **per Account**, and an address cannot stand in for one — Better Auth treats `A@x.com` and `a@x.com` as the same person, so the directory compares `lower(email)`), ask the limit, then send. A limit consulted after the send is a log line.

| Limit            | Value                            |
| ---------------- | -------------------------------- |
| Per rolling hour | 3 links, sign-up's link included |
| Minimum gap      | 60 seconds                       |

Both live in one constant, `RESEND_LIMITS`, with an overridable parameter on the pure decision (`resendAllowance`). **The figures are a starting value to tune, not a principle** — an open question on the workstream.

**The one-a-minute floor is load-bearing beyond politeness, and it rests on the clock.** Better Auth stamps a token's `iat` from `Date.now()` at one-second resolution and adds no nonce, so two links issued for one address inside the same real second are **byte-identical** — and an older link byte-identical to the newest is not invalidated, because it _is_ the newest. The floor is what puts a minute between them, and it is measured on the injected `Clock`. So invalidation holds only while that clock tracks real time, which `lib/services.ts` guarantees by wiring `createSystemClock()` — asserted in its own test, because a frozen clock would weaken invalidation silently rather than loudly. A test that advanced only the injected clock reached the identical-token case in milliseconds, which is how this was found.

Three answers can come back — `sent`, `too-soon`, `too-many` — and **`sent` does not mean an email went out**. An unknown address and an already-verified one both produce `sent`, because the alternative is an endpoint that answers "does this address have an unverified account here" for anyone who asks. The two refusals are shown honestly, since telling somebody "you may try again in 40 seconds" is worth more than the residual signal, and the fast path out is padded to the same 500 ms floor Better Auth uses on its own unauthenticated email endpoints (`RESPONSE_FLOOR_MS`) so the _timing_ does not give away what the body will not.

### Signing in before verifying

Better Auth answers `403 EMAIL_NOT_VERIFIED`, and that is rendered as **the hold screen with a resend action, never an error**: nothing has gone wrong, and the Handle is still held. `signInAction` turns the 403 into a redirect to that person's own hold screen, naming their Handle. A wrong password is a different thing and stays on the form; Better Auth answers it with 401 before verification is ever considered, so guessing reveals nothing about whether an address is registered.

The refusal is recognised by **reading properties, not `instanceof APIError`**: `--experimental-vm-modules` runs ESM in its own realm, so an `instanceof` check silently fails in tests while appearing to work in production.

A successful password reset does **not** mark the email verified, even though it proves control of the address. The two are kept separate so the Claim gate has exactly one meaning.

### Reading the session, and what is allowed to depend on it

`lib/session.ts` asks Better Auth for the session behind the incoming request's headers, and it is the **only** place an identity enters the application. Everything that authorises anything is decided about the value it returns, never about a user id or a Handle arriving in a request body — the first surface to rely on that is the Profile edit (see [system-overview.md](system-overview.md) § Editing the Profile).

It answers `undefined` rather than throwing when it cannot tell: the services may not be configured and the session lookup is a database read that can be refused. **That direction is not a preference.** Failing open here would be an authorisation bypass; failing closed is a signed-in owner being asked to sign in again.

## Adjacent behaviour

Duplicate sign-ups return a synthetic success, so the API never reveals whether an address is registered. Because every live Account owns exactly one Handle, a duplicate address can never claim a second one; the existing owner is told by email instead — naming the Handle they already own, and linking to the reset **form** rather than carrying a tokenised reset link, because sign-up is unauthenticated and a tokenised link there would let a stranger have live reset tokens mailed to somebody else's inbox. Nothing yet limits how many of those notices one address can receive; that is the workstream's Phase 5 item on rate-limiting every email-sending endpoint.

Resend is rate limited per Account (above). The claim endpoint itself is not, and nor is the collision notice — both are Phase 5.

## The tables, as they exist today

Defined in `packages/core/src/db/schema.ts`, migrated by `packages/core/migrations/0000_auth_tables.sql`.

| Table                   | Holds                                                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user`                  | Identity: name, unique email, `email_verified`, timestamps                                                                                                                |
| `session`               | A session row per sign-in: unique token, expiry, IP, user agent, cascading to `user`                                                                                      |
| `account`               | One row per auth method. For email and password, `provider_id = "credential"` and the hashed password lives in `account.password`. Cascades to `user`                     |
| `verification`          | Better Auth's own token table. **Password-reset tokens only in practice**: email verification is a stateless JWT it never stores                                          |
| `verification_dispatch` | One row per verification link _we_ issued — the fingerprint, the Account and the time. Ours, not Better Auth's; see [the data model](data-model.md#verification-dispatch) |

**The Drizzle property keys are load-bearing.** Better Auth's adapter looks a table up by model name and addresses columns by the Drizzle property key, so renaming one breaks authentication at runtime rather than at build time. `schema.test.ts` calls Better Auth's own `getAuthTables()` and asserts our tables against it, so an upstream change that adds a column fails a test instead of production.

Database column names are snake_case and free to differ from the property keys, because the adapter never sees them.
