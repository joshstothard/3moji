# Authentication

**Built, not yet deployed.** The tables, the auth instance, the HTTP routes and the verification flow all exist; nothing is running against a real database until #32 provisions one. The shape is decided in [ADR-0006](../adr/0006-nextjs-on-vercel-is-the-whole-application.md).

## Where each piece lives

| Piece                               | Lives in                                                                             |
| ----------------------------------- | ------------------------------------------------------------------------------------ |
| The auth instance and its settings  | `packages/core/src/auth/create-auth.ts`                                              |
| The email port and its two adapters | `packages/core/src/auth/ports/`, `packages/core/src/auth/adapters/`                  |
| The wiring                          | `apps/web/src/lib/services.ts`, the only module that reads the environment           |
| The HTTP surface                    | `apps/web/src/app/api/auth/[...all]/route.ts`                                        |
| The verification landing            | `apps/web/src/app/claim/verify/route.ts`                                             |
| The hold screen and resend          | `apps/web/src/app/claim/held/`, `src/components/hold-screen.tsx`                     |
| The Claim's rate limit              | `packages/core/src/handle/claim-rate-limit.ts`, `apps/web/src/lib/client-address.ts` |
| Better Auth's rate limit            | `packages/core/src/auth/auth-rate-limit.ts`, applied in `create-auth.ts`             |
| Resend's per-client-address limit   | `packages/core/src/auth/resend-rate-limit.ts`                                        |
| Reading the session                 | `apps/web/src/lib/session.ts`, the one place an identity enters the app              |

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

**The Claim is the only way an Account is created, and that is enforced, not just true of the UI** ([#150](https://github.com/joshstothard/3moji/issues/150)). Better Auth serves `POST /api/auth/sign-up/email` through the catch-all route, and before #150 a direct request to it — measured against Postgres in `direct-sign-up.integration.test.ts` — created an Account with **no Handle** and sent a verification email, from an endpoint nothing limited then. That is the handle-less state ADR-0004 decision 4 forbids.

`createAuth` now sets Better Auth's `disabledPaths` to `/sign-up/email` and `/sign-in/social`, and both answer a plain `404 Not Found` over HTTP.

**Why `disabledPaths` and not `emailAndPassword.disableSignUp`, measured rather than assumed:**

| Option                           | Where better-auth 1.7.4 checks it                            | Refuses HTTP sign-up | Refuses the Claim's server-side `auth.api.signUpEmail` |
| -------------------------------- | ------------------------------------------------------------ | -------------------- | ------------------------------------------------------ |
| `emailAndPassword.disableSignUp` | Inside the endpoint's own body                               | Yes                  | **Yes** — throws `EMAIL_PASSWORD_SIGN_UP_DISABLED`     |
| `disabledPaths`                  | The router's `onRequest`, which only an HTTP request reaches | Yes                  | No                                                     |

So `disableSignUp` would take the Claim down with the bypass, and blocking the path in the Next.js route handler would put a security rule in a transport adapter that no integration test can reach. `disabledPaths` lives in `packages/core`, beside the rest of the auth settings.

**The refusal cannot enumerate addresses.** It is decided on the path alone, before the body is parsed or the database is read, so a registered address, an unregistered one and a request with no address at all get the same status, the same body and — because no address-dependent work runs — the same timing. That is stronger than padding to `RESPONSE_FLOOR_MS`, which exists for answers that _do_ depend on an address.

**Which endpoints can create an Account.** In better-auth 1.7.4 `internalAdapter.createUser` has exactly two callers: email sign-up, and `handleOAuthUserInfo`, reached from `/sign-in/social` and `/callback/:id`. No social provider is configured, so the OAuth paths cannot create an Account today; `/sign-in/social` is disabled anyway, so the first provider added does not quietly reopen the bypass. `/callback/:id` cannot be listed — `disabledPaths` matches the exact path — and needs OAuth state issued by `/sign-in/social` or by `/link-social`, which requires a signed-in Account. **Recheck the list on every Better Auth upgrade and every plugin added**: a plugin such as magic link, email OTP or anonymous sign-in brings its own Account-creating endpoints.

#### Rechecking the Account-creation audit

**The build enforces the recheck** ([#169](https://github.com/joshstothard/3moji/issues/169)). The audited facts live in one place, `scripts/better-auth-audit.mjs`: the installed versions of `better-auth`, `@better-auth/core` and `@better-auth/drizzle-adapter`; every `create…User…` identifier in their runtime JavaScript, per file; every direct write of the `user` model; the Better Auth modules the application imports; the `plugins` options it passes; and `HTTP_DISABLED_AUTH_PATHS`. `scripts/better-auth-audit.test.mjs`, under `npm run test:scripts`, fails when any of them stops matching the installed tree or the source. In 1.7.4 the internal adapter has two user-writing methods: `createUser`, whose callers are described above, and `createOAuthUser`, which nothing calls. The other callers sit in plugins that are not configured. When the check fails:

1. **Find what changed.** The failure names the file, and the installed and audited values. For a version bump, read the release notes and diff the installed `dist` against the audited version.
2. **Trace each new or changed caller** of `createUser`, `createOAuthUser` or a new user-writing method back to the endpoints that reach it, and check whether any of them is served over HTTP without a Claim. For a new plugin, list its endpoints and check the same.
3. **Close any new path** by adding it to `HTTP_DISABLED_AUTH_PATHS`, or by not adopting the change, and prove the refusal in `direct-sign-up.integration.test.ts`.
4. **Only then update `scripts/better-auth-audit.mjs`** and this section to the new facts, in the same pull request. Editing the audited facts to turn the check green without steps 1 to 3 defeats it.

The check reports a change; it does not judge reachability. Its test file lists what it cannot see, such as a model name built at runtime or a plugin list assembled outside `src/`.

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

`resendVerification` (`packages/core/src/auth/resend-verification.ts`) is the whole rule; the server action over it decides nothing but which client address the forwarded headers state. Four steps, in this order: ask the **per-client-address** limit, resolve the address to an Account (the next limit is **per Account**, and an address cannot stand in for one — Better Auth treats `A@x.com` and `a@x.com` as the same person, so the directory compares `lower(email)`), ask the per-Account limit, then send. A limit consulted after the send is a log line.

| Limit                              | Value                            | Constant                   |
| ---------------------------------- | -------------------------------- | -------------------------- |
| Per Account, per rolling hour      | 3 links, sign-up's link included | `RESEND_LIMITS`            |
| Per Account, minimum gap           | 60 seconds                       | `RESEND_LIMITS`            |
| Per client address, per fixed hour | 10 requests                      | `RESEND_CLIENT_RATE_LIMIT` |

`RESEND_LIMITS` has an overridable parameter on the pure decision (`resendAllowance`); `RESEND_CLIENT_RATE_LIMIT` one on `createResendClientRateLimiter`. **The figures are starting values to tune, not principles** — open questions on the workstream, and the per-client one is flagged for the repo owner on [#158](https://github.com/joshstothard/3moji/issues/158)'s pull request.

**The per-client-address limit comes first, before the address is read** ([#158](https://github.com/joshstothard/3moji/issues/158)). The per-Account limit bounds the mail one inbox receives; it does nothing about one client walking a list of addresses, and since an unknown or verified address answers `sent` without reaching it, those requests were unlimited. Counted before the lookup, every request counts, whatever it names — so a registered address is limited exactly as an unregistered one. Its refusal is `too-many` with its own "when", which the hold screen already renders: the "when" comes from the client's window alone and says nothing about the address. It is padded to the same floor.

It **reuses the Claim's counter table and store** (`claim_rate_limit`, `ClaimRateLimitStore`) under its own bucket kind, `resend-client:` and an HMAC of the grouped client address, rather than adding a second table and a second hashing scheme: the question is the same, and so is the one-statement increment that answers it without a race. The address is grouped by `clientAddressBucket`, as the Claim's is, and the limiter fails closed — a store that cannot count makes the action answer `failed`. Every limiter on the shared table prunes by one retention, `RATE_LIMIT_RETENTION_MS` (an hour), never by its own window, so a shorter window on one limiter cannot delete another's live counter; a test asserts every shipped window fits inside it.

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

Duplicate sign-ups return a synthetic success, so the API never reveals whether an address is registered. Because every live Account owns exactly one Handle, a duplicate address can never claim a second one; the existing owner is told by email instead — naming the Handle they already own, and linking to the reset **form** rather than carrying a tokenised reset link, because sign-up is unauthenticated and a tokenised link there would let a stranger have live reset tokens mailed to somebody else's inbox. How many of those notices one address can receive is bounded by the Claim's per-email rate limit (below), which refuses the submission before the Claim opens.

Resend is rate limited per Account and per client address (above), the Claim per email and per client address (below), and Better Auth's own HTTP endpoints per client address and path ([below](#better-auths-rate-limit)).

### Better Auth's rate limit

**Better Auth's HTTP endpoints are rate limited in every environment, counted in Postgres** ([#158](https://github.com/joshstothard/3moji/issues/158)). `createAuth` passes `authRateLimitOptions()` and `authClientAddressOptions()` from `packages/core/src/auth/auth-rate-limit.ts`.

| Path                            | Limit per client address | Constant (`AUTH_RATE_LIMITS`) |
| ------------------------------- | ------------------------ | ----------------------------- |
| `POST /sign-in/email`           | 10 in 15 minutes         | `signInEmail`                 |
| `POST /request-password-reset`  | 5 an hour                | `requestPasswordReset`        |
| `POST /send-verification-email` | 5 an hour                | `sendVerificationEmail`       |
| every other `/api/auth/*` path  | 100 in 10 seconds        | `default`                     |

Windows are **rolling**, in seconds — Better Auth's own semantics and unit. **Starting values to tune**, flagged for the repo owner on the pull request. Sign-in allows somebody who has forgotten which password they used and is far too few to guess one; the two email paths send mail to an address the caller chooses, so they bound how much mail one client can make us send to somebody else.

**What better-auth 1.7.4 does unconfigured, measured from its source rather than assumed:**

- **`enabled` defaults to `NODE_ENV === "production"`.** Every preview and every local run would be unlimited, and nothing would test the limit. It is set to `true` explicitly; `create-auth.test.ts` proves it is on under `NODE_ENV=test`.
- **`storage` defaults to `memory`**, a `Map` in the process. On Vercel every serverless instance has its own, so it would limit nothing. It is `database`.
- **Built-in rules apply the moment limiting is on**: `/sign-in*`, `/sign-up*`, `/change-password*`, `/change-email*` at 3 in 10 seconds, and the two email paths at 3 a minute. `customRules` replaces them for our three paths with named, documented values; **none is 3**, so the integration test that finds the Nth request admitted and the (N+1)th refused proves our rule is the one in force, and that its path string matches the path as Better Auth routes it (the pathname with `/api/auth` removed and trailing slashes stripped, compared exactly).

**`/sign-up/email` needs no rule.** #150's `disabledPaths` check runs in the router's `onRequest` before the limiter, so the path answers 404 without ever being counted — asserted: twelve requests, twelve 404s, no counter row. **The limiter is HTTP-only**, for the same reason `disabledPaths` is: it runs in `onRequest`, which `auth.api.*` calls never pass through. So the Claim's server-side `auth.api.signUpEmail` is not counted, and neither is anything else the app calls server-side.

> **A gap this leaves, recorded rather than hidden.** The sign-in **form** does not use `POST /api/auth/sign-in/email`: `signInAction` calls `auth.api.signInEmail` server-side, so Better Auth's limiter does not see it. The public HTTP endpoint is limited; the server action in front of the same credential check is not. Closing it is a per-client-address limit on the action, as the Claim and resend have — a follow-up, not done here.

**Who is one client.** `advanced.ipAddress.ipAddressHeaders` is `CLIENT_ADDRESS_HEADERS` — `x-vercel-forwarded-for`, then `x-forwarded-for` — the same list, in the same order, that `apps/web/src/lib/client-address.ts` reads (its test pins the two together). Both group IPv6 by `/64` and count an IPv4-mapped IPv6 address as its IPv4 address; the integration test proves each against Better Auth's own handler. **One difference is kept on purpose:** with no `trustedProxies`, Better Auth trusts a header only when it holds a single address and falls through to the next header otherwise, and a request with no trustworthy address shares one `no-trusted-ip` counter per path — the analogue of our `unknown` bucket. Our transport takes the first entry of a list instead. On Vercel the edge sets both headers to one address, so the two agree; anywhere else both headers are client-writable anyway (see [the Claim's rate limit](#the-claims-rate-limit)). Setting `trustedProxies` to close the gap would add a spoofing surface to buy nothing. Better Auth falls back to `127.0.0.1` under `NODE_ENV` `test` or `development`, which is why every integration request names its client.

**A refusal cannot enumerate addresses.** The counter is keyed on client address and path; the body is never read before the decision. A refused request answers `429 Too Many Requests`, `{"message":"Too many requests. Please try again later."}` and an `X-Retry-After` header computed from that counter and the clock. `auth-rate-limit.integration.test.ts` compares the whole refused password-reset response — status, status text, body, every header — for a registered address, an unregistered one and a request naming no address, each on an equally spent counter, and again for both addresses on one counter: identical, with `X-Retry-After` agreeing to within the one second two requests can straddle. A refused request sends no email.

**Counters live in Postgres** (`auth_rate_limit`, see [the tables](#the-tables-as-they-exist-today)), keyed `<address>|<path>`. **Unlike the Claim's buckets they are not hashed**: Better Auth builds the key and offers no hook. The same addresses are already stored in `session.ip_address`, and Better Auth prunes rows older than its longest window, so the table holds about an hour of history.

**It fails closed.** A counter that cannot be read rejects inside the router's `onRequest`, which better-call does not catch, so `createAuth` wraps `auth.handler` to answer that `DatabaseQueryFailed` — already stripped of bound values by `safeDatabaseAdapter` (#148) — with a bare 500, as every other database failure on the route is answered. Nothing is admitted; any other error is rethrown untouched.

### The Claim's rate limit

`submitClaim` asks `ClaimRateLimiter` (`packages/core/src/handle/claim-rate-limit.ts`) before anything else, and a submission over either limit gets `rate-limited` without the Claim's transaction ever opening — so it creates nothing and mails nobody, which is what bounds the collision notices one inbox can receive ([#157](https://github.com/joshstothard/3moji/issues/157)).

| Limit              | Value                  |
| ------------------ | ---------------------- |
| Per email address  | 3 submissions an hour  |
| Per client address | 10 submissions an hour |

Both live in one constant, `CLAIM_RATE_LIMITS`, with an overridable parameter on the pure decision (`claimAdmission`). **Starting values to tune**, flagged for the repo owner on the pull request. Both windows are **fixed**, not rolling, so a bucket can make up to twice its limit across a window boundary: that is the price of an increment Postgres takes atomically in one statement.

**Non-enumeration holds because the limit counts submissions, never Accounts.** Nothing in the limiter reads whether an address is registered, so a registered address is limited exactly as an unregistered one is. The answer carries no field saying which limit bound and no "try again in" — a client-address window and an email window would disagree about "when", and that is the signal — and it is padded to `RESPONSE_FLOOR_MS` like the answers about an address. Both counters are incremented on every submission, in one statement, so the two refusals also take the same time. `apps/web/src/components/claim-rate-limit.test.tsx` compares all of it, end to end.

**Counters live in Postgres** (`claim_rate_limit`, see [data-model.md](data-model.md#claim-rate-limit)), keyed on a **keyed hash** rather than an address: `HMAC-SHA256` under a key derived from `BETTER_AUTH_SECRET` with a fixed label. The table alone does not reveal who tried to claim, and a guessed address cannot be confirmed without the secret, which a plain SHA-256 would allow. No new secret is required. The email address is normalised first (#163), so `Someone@Example.com` and `someone@example.com` share a counter.

**It fails closed.** A store that cannot be read or written makes `admit` reject; the claim action's catch logs it through `logFailure` (`claim_submit_failed`) and answers `failed`. A Claim needs the database anyway.

**The client address, and what it trusts.** `apps/web/src/lib/client-address.ts` reads `x-vercel-forwarded-for`, then `x-forwarded-for`, and takes the first entry. On Vercel both are set by Vercel's edge, which overwrites `X-Forwarded-For` and does not forward external IPs to prevent spoofing; `x-vercel-forwarded-for` cannot be overwritten by a proxy in front of Vercel. So the address is trusted **because the platform set it, and only on Vercel**. Anywhere else — `next dev`, a container, behind a proxy that passes the header through — a client can write it, and the per-client limit can be sidestepped or aimed at somebody else; the per-email limit does not depend on it. The domain validates the value (`clientAddressBucket`): IPv4 counts per address, IPv6 per `/64` (one subscriber is routinely given a whole `/64`), an IPv4-mapped IPv6 address as its IPv4 address, and anything missing or malformed in **one shared `unknown` bucket**. That costs something — everybody whose address cannot be read shares one limit — and is chosen over the alternative, in which omitting the header would bypass the limit.

**A cost the requirement carries.** A per-email limit keyed on the _submitted_ address lets somebody spend a victim's three submissions and hold up that victim's own Claim for up to an hour.

## The tables, as they exist today

Defined in `packages/core/src/db/schema.ts`, migrated by `packages/core/migrations/0000_auth_tables.sql`.

| Table                   | Holds                                                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user`                  | Identity: name, unique email, `email_verified`, timestamps                                                                                                                |
| `session`               | A session row per sign-in: unique token, expiry, IP, user agent, cascading to `user`                                                                                      |
| `account`               | One row per auth method. For email and password, `provider_id = "credential"` and the hashed password lives in `account.password`. Cascades to `user`                     |
| `verification`          | Better Auth's own token table. **Password-reset tokens only in practice**: email verification is a stateless JWT it never stores                                          |
| `verification_dispatch` | One row per verification link _we_ issued — the fingerprint, the Account and the time. Ours, not Better Auth's; see [the data model](data-model.md#verification-dispatch) |
| `auth_rate_limit`       | Better Auth's rate-limit counters, one per client address and path (#158, migration `0007_auth_rate_limit`); see [the data model](data-model.md#auth-rate-limit)          |

**The Drizzle property keys are load-bearing.** Better Auth's adapter looks a table up by model name and addresses columns by the Drizzle property key, so renaming one breaks authentication at runtime rather than at build time. `schema.test.ts` calls Better Auth's own `getAuthTables()` and asserts our tables against it, so an upstream change that adds a column fails a test instead of production.

Database column names are snake_case and free to differ from the property keys, because the adapter never sees them.
