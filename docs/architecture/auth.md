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
| Hashing Better Auth's counter keys  | `packages/core/src/auth/auth-rate-limit-key.ts`, applied in `create-auth.ts`         |
| Resend's per-client-address limit   | `packages/core/src/auth/resend-rate-limit.ts`                                        |
| The sign-in form's limit            | `packages/core/src/auth/sign-in-rate-limit.ts`, gated in `sign-in-action.ts`         |
| Password reset                      | `packages/core/src/auth/password-reset.ts`, `apps/web/src/app/reset-password/`       |
| The reset request form's limit      | `packages/core/src/auth/reset-request-rate-limit.ts`                                 |
| Reading the session                 | `apps/web/src/lib/session.ts`, the one place an identity enters the app              |
| The signed-in indicator's answer    | `packages/core/src/auth/viewer-summary.ts`, `apps/web/src/lib/viewer.ts`             |
| The signed-in indicator             | `apps/web/src/app/api/viewer/route.ts`, `src/components/account-menu.tsx`            |

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

A successful password reset does **not** mark the email verified, even though it proves control of the address. The two are kept separate so the Claim gate has exactly one meaning. Both halves are asserted against Postgres in `auth.integration.test.ts`: through Better Auth directly, and through the reset pages' own use case (#192).

### Password reset

**An owner who forgets their password can set a new one, from two pages** ([#192](https://github.com/joshstothard/3moji/issues/192)): `/reset-password`, which asks for a link, and `/reset-password/<token>`, which the link opens. The sign-in page links to the first as "Forgot your password?", and so does the claim-collision email (`CoreServices.resetRequestUrl`), which 404'd before these pages existed. Both are plain `<form>`s posting to server actions, so both work without JavaScript; each action writes one boundary line, `password-reset.request` and `password-reset.set` ([system-overview.md](system-overview.md#api-boundary-logging)). Changing a password while signed in, and changing an email address, are not built.

**The link points at our page, and the token stays a path segment.** Better Auth builds `{baseURL}/api/auth/reset-password/<token>?callbackURL=…` — its `GET` callback, which checks the token and then redirects with the token moved into a **query string**, or, for a bad token, to `?error=INVALID_TOKEN` with the token gone; given no callback, which is what the app passed before #192, it redirects to Better Auth's own error page. So `createAuth`'s `sendResetPassword` hook rewrites it to `{baseUrl}/reset-password/<token>`, for the reasons the verification link is rewritten (above): the page is ours, and a bad token is answered there, in our words. The callback is bypassed entirely; the token's expiry is checked, and the token consumed, by `auth.api.resetPassword` when the form is submitted. No `redirectTo` is passed, which also keeps the request out of Better Auth's `originCheck`.

**The page does not check the token when it renders.** An invalid, used or expired token is found when the form is submitted, and all three send the visitor to the request form with one message (`?notice=link-invalid`) — which also leaves the dead token out of the address bar. A password Better Auth refuses as too short or too long returns to the same link with `?error=`. The lengths are stated, `PASSWORD_MIN_LENGTH` (8) and `PASSWORD_MAX_LENGTH` (128) in `packages/core/src/auth/password-length.ts`, rather than left to Better Auth's defaults, so the form tells the browser the numbers the server enforces. The set-new-password page sends no referrer to other sites (`same-origin`) and is not indexed, because its address holds the token. **Not `no-referrer`:** with it, the no-JavaScript E2E run found the form's own POST refused by Next.js as `Invalid Server Actions request`, and `same-origin` fixes it. The likely mechanism is the request's `Origin` failing Next.js's server-action origin check, but that was not measured.

**Success revokes every session and verifies nothing.** `revokeSessionsOnPasswordReset` deletes every session row, so a request carrying a pre-reset session cookie is signed out — this browser's too, which is why success lands on `/sign-in?notice=password-reset`. The Account's `email_verified` is untouched (above).

**The request answers the same for every address.** `requestPasswordReset` asks the per-client limit (below), then `auth.api.requestPasswordReset`, which mails a registered address and simulates the work for an unknown one; both answer `sent`, rendered as "if that address belongs to an account, a reset link is on its way". **Every answer is padded to `RESPONSE_FLOOR_MS`**, the refusal included. The floor pads the fast branches; a real send slower than 500 ms is still slower, the price the resend flow already pays. A failure — a limiter that cannot count, a send that throws — answers `failed` and is logged through `logFailure` (`password_reset_request_failed`, `password_reset_set_failed`). `password-reset-request.test.tsx` runs the real action, use case, floor and limiter for a registered and an unregistered address and compares everything observable.

#### The reset request form's rate limit

**The form accepts no more requests from one client than the HTTP endpoint does**, for the reason the sign-in form's limit exists: `requestPasswordReset` is a server-side `auth.api.*` call, which Better Auth's limiter never sees. The limit is asked first, handed the client address alone, and beyond it the form answers `?notice=rate-limited` without calling Better Auth.

| Limit              | Value             | Constant                          |
| ------------------ | ----------------- | --------------------------------- |
| Per client address | 5 in a fixed hour | `RESET_REQUEST_CLIENT_RATE_LIMIT` |

**Derived from `AUTH_RATE_LIMITS.requestPasswordReset`, not restated**, and the window semantics differ in the same way as the sign-in form's (a fixed window on the shared table). It reuses the Claim's table, store and hashing under the bucket kind `reset-request-client:`, its hour fits exactly inside `RATE_LIMIT_RETENTION_MS`, it fails closed, and its refusal says no "when". **A refusal cannot enumerate addresses:** nothing but the client address reaches the limiter, so a registered and an unregistered address are refused identically, and the refusal is padded to the floor like every other answer.

**The set-new-password form has no limit of its own.** Better Auth's `POST /reset-password` falls under the `default` rule over HTTP, and the form bypasses even that; what it would protect is a guess at a 24-character random token that expires in an hour, which no rate of guessing reaches.

### Reading the session, and what is allowed to depend on it

`lib/session.ts` asks Better Auth for the session behind the incoming request's headers, and it is the **only** place an identity enters the application. Everything that authorises anything is decided about the value it returns, never about a user id or a Handle arriving in a request body — the first surface to rely on that is the Profile edit (see [system-overview.md](system-overview.md) § Editing the Profile).

It answers `undefined` rather than throwing when it cannot tell: the services may not be configured and the session lookup is a database read that can be refused. **That direction is not a preference.** Failing open here would be an authorisation bypass; failing closed is a signed-in owner being asked to sign in again.

**What may read it is as much the rule as how it is read** ([#193](https://github.com/joshstothard/3moji/issues/193)). Three things do: the Profile edit page and `saveProfileAction`, through `lib/profile-edit.ts`, and `GET /api/viewer`, through `lib/viewer.ts`. **Shared chrome and the public Profile never do** — not the root layout, not the navbar, not `app/[handle]/page.tsx`. Anything that wraps every page and reads the session makes every page's response differ by visitor, and the Handle page is the most-read page in the product. So the navbar's signed-in indicator is a client island that asks `GET /api/viewer` after hydration, and the Profile's HTML stays the same bytes for everybody. `apps/web/eslint.config.mjs` fails lint if any of those three files, or the island itself, imports `next/headers`, `lib/session`, `lib/profile-edit` or `lib/viewer`, and `app/layout.test.tsx` renders the whole shell and asserts neither `headers()` nor `cookies()` is called. The indicator is described in [system-overview.md](system-overview.md#the-signed-in-indicator).

`GET /api/viewer` answers `viewerSummary`'s decision about **the session's own Account and nobody else's** — `signed-out`, `signed-in`, or `owner` with that Handle's key and encoded path, and nothing more: no user id, no email. It is not Better Auth's `/api/auth/get-session`, which answers the session object itself and would undo the cookie's `HttpOnly` if page JavaScript read it. It is sent `Cache-Control: private, no-store` with `Vary: Cookie`, because a shared cache that stored it would hand one person's links to the next visitor. It fails closed the way `readViewer` does: no readable session is `signed-out`, and an Account read that fails for a viewer the session named is `signed-in` with no Handle — never `signed-out`, which would hide sign-out (#194) from somebody who is signed in — logged through `logFailure` as `viewer_summary_read_failed`. It links; it never authorises.

## Adjacent behaviour

Duplicate sign-ups return a synthetic success, so the API never reveals whether an address is registered. Because every live Account owns exactly one Handle, a duplicate address can never claim a second one; the existing owner is told by email instead — naming the Handle they already own, and linking to the reset **form** (`/reset-password`, [above](#password-reset)) rather than carrying a tokenised reset link, because sign-up is unauthenticated and a tokenised link there would let a stranger have live reset tokens mailed to somebody else's inbox. `password-reset.spec.ts` requests the link the composition root builds and asserts it answers 200. How many of those notices one address can receive is bounded by the Claim's per-email rate limit (below), which refuses the submission before the Claim opens.

Resend is rate limited per Account and per client address (above), the password reset request form per client address ([above](#the-reset-request-forms-rate-limit)), the Claim per email and per client address (below), Better Auth's own HTTP endpoints per client address and path ([below](#better-auths-rate-limit)), and the sign-in form per client address ([below](#the-sign-in-forms-rate-limit)).

### Better Auth's rate limit

**Better Auth's HTTP endpoints are rate limited in every environment, counted in Postgres** ([#158](https://github.com/joshstothard/3moji/issues/158)). `createAuth` passes `authRateLimitOptions()` and `authClientAddressOptions()` from `packages/core/src/auth/auth-rate-limit.ts`.

| Path                            | Limit per client address | Constant (`AUTH_RATE_LIMITS`) |
| ------------------------------- | ------------------------ | ----------------------------- |
| `POST /sign-in/email`           | 10 in 15 minutes         | `signInEmail`                 |
| `POST /request-password-reset`  | 5 an hour                | `requestPasswordReset`        |
| `POST /send-verification-email` | 5 an hour                | `sendVerificationEmail`       |
| every other `/api/auth/*` path  | 100 in 10 seconds        | `default`                     |

Windows are in seconds, and **neither fixed nor rolling** — Better Auth's own semantics, measured from `decideConsume` and its database wrapper: a counter resets only once `window` has passed since its last _admitted_ request, and every admitted request moves that point forward (a refused one does not). So requests spaced just under the window apart keep one counter alive indefinitely — ten sign-ins fourteen minutes apart exhaust `signInEmail` across 140 minutes — while a client that stops for one full window starts again from zero. **Starting values to tune**, flagged for the repo owner on the pull request. Sign-in allows somebody who has forgotten which password they used and is far too few to guess one; the two email paths send mail to an address the caller chooses, so they bound how much mail one client can make us send to somebody else.

**What better-auth 1.7.4 does unconfigured, measured from its source rather than assumed:**

- **`enabled` defaults to `NODE_ENV === "production"`.** Every preview and every local run would be unlimited, and nothing would test the limit. It is set to `true` explicitly; `create-auth.test.ts` proves it is on under `NODE_ENV=test`.
- **`storage` defaults to `memory`**, a `Map` in the process. On Vercel every serverless instance has its own, so it would limit nothing. It is `database`.
- **Built-in rules apply the moment limiting is on**: `/sign-in*`, `/sign-up*`, `/change-password*`, `/change-email*` at 3 in 10 seconds, and the two email paths at 3 a minute. `customRules` replaces them for our three paths with named, documented values; **none is 3**, so the integration test that finds the Nth request admitted and the (N+1)th refused proves our rule is the one in force, and that its path string matches the path as Better Auth routes it (the pathname with `/api/auth` removed and trailing slashes stripped, compared exactly).

**`/sign-up/email` needs no rule.** #150's `disabledPaths` check runs in the router's `onRequest` before the limiter, so the path answers 404 without ever being counted — asserted: twelve requests, twelve 404s, no counter row. **The limiter is HTTP-only**, for the same reason `disabledPaths` is: it runs in `onRequest`, which `auth.api.*` calls never pass through. So the Claim's server-side `auth.api.signUpEmail` is not counted, and neither is anything else the app calls server-side.

**Neither the sign-in form nor the reset request form is behind this limiter.** The reset request form has its own limit ([above](#the-reset-request-forms-rate-limit)). The sign-in form does not use `POST /api/auth/sign-in/email`: `signInAction` calls `auth.api.signInEmail` server-side, so Better Auth's limiter never sees it — measured in `sign-in-rate-limit.test.tsx`, which found the form accepting eleven attempts from one client where the endpoint allows ten. It has its own limit, with the same numbers: see [the sign-in form's rate limit](#the-sign-in-forms-rate-limit).

**Who is one client.** `advanced.ipAddress.ipAddressHeaders` is `CLIENT_ADDRESS_HEADERS` — `x-vercel-forwarded-for`, then `x-forwarded-for` — the same list, in the same order, that `apps/web/src/lib/client-address.ts` reads (its test pins the two together). Both group IPv6 by `/64` and count an IPv4-mapped IPv6 address as its IPv4 address; the integration test proves each against Better Auth's own handler. **One difference is kept on purpose:** with no `trustedProxies`, Better Auth trusts a header only when it holds a single address and falls through to the next header otherwise, and a request with no trustworthy address shares one `no-trusted-ip` counter per path — the analogue of our `unknown` bucket. Our transport takes the first entry of a list instead. On Vercel the edge sets both headers to one address, so the two agree; anywhere else both headers are client-writable anyway (see [the Claim's rate limit](#the-claims-rate-limit)). Setting `trustedProxies` to close the gap would add a spoofing surface to buy nothing. Better Auth falls back to `127.0.0.1` under `NODE_ENV` `test` or `development`, which is why every integration request names its client.

**A request with no readable address is still limited — and `disableIpTracking` must never be set.** In better-auth 1.7.4 `resolveRateLimitConfig` does not skip such a request: it warns once and counts it in the shared `no-trusted-ip|<path>` bucket. With `advanced.ipAddress.disableIpTracking: true` it returns no rule instead, and a client that simply omits the forwarded headers escapes every auth limit. `auth-rate-limit.test.ts` asserts the option is never set, and the integration test sends sign-ins with no forwarded header, finding them limited in one shared bucket that a real client does not share; setting the option turns both red. Under `NODE_ENV=test` the shared key is `127.0.0.1|/sign-in/email`, not `no-trusted-ip|…`, so the production key string is recorded from source rather than observed. Either is stored hashed, like every key ([below](#better-auths-rate-limit)).

**A refusal cannot enumerate addresses.** The counter is keyed on client address and path; the body is never read before the decision. A refused request answers `429 Too Many Requests`, `{"message":"Too many requests. Please try again later."}` and an `X-Retry-After` header computed from that counter and the clock. `auth-rate-limit.integration.test.ts` compares the whole refused password-reset response — status, status text, body, every header — for a registered address, an unregistered one and a request naming no address, each on an equally spent counter, and again for both addresses on one counter: identical, with `X-Retry-After` agreeing to within the one second two requests can straddle. A refused request sends no email.

**Counters live in Postgres** (`auth_rate_limit`, see [the tables](#the-tables-as-they-exist-today)), and **their keys are hashed, like the Claim's buckets** ([#214](https://github.com/joshstothard/3moji/issues/214)). Better Auth still builds `<address>|<path>` and still decides every request. `hashedRateLimitKeys` (`packages/core/src/auth/auth-rate-limit-key.ts`), wrapped around the database adapter in `createAuth`, replaces that value with an HMAC-SHA256, hex, under a key derived from `BETTER_AUTH_SECRET` before any statement reaches the table. It is the same scheme as `keyedRateLimitBucket` under its own label, so a stored key cannot be confirmed by hashing a guessed address. The whole key is hashed, path included, so each client still has one counter per path.

**Why the adapter and not `rateLimit.customStorage`.** In better-auth 1.7.4 a custom storage _replaces_ the database storage (`getRateLimitStorage` returns it outright), and the database storage, `createDatabaseStorageWrapper`, is not exported. Using it would mean reimplementing the guarded `incrementOne` calls, the create-retry, pruning and `X-Retry-After` — exactly what the integration suite pins. Wrapping the adapter leaves all of it Better Auth's; `authRateLimitOptions()` is unchanged, which `auth-rate-limit.test.ts` and `create-auth.test.ts` assert. `advanced.ipAddress` offers no transform, and one would change `session.ip_address` too. The limiter's only calls on its model are `findMany` and `incrementOne` by `key`, `create` with `data.key` and `deleteMany` by `lastRequest`; the wrapper hashes a `key` in every adapter method on that model regardless, so a version that reads the key another way is still covered. It logs nothing, and the only error it throws — an empty secret, which `createAuth` already refuses — carries no key.

`auth-rate-limit.integration.test.ts` sends requests from a known IPv6 and IPv4 client and finds neither address, nor the `/64` in either spelling, in any column of any row — and finds each counter under its hashed key, one per client and path. **Rotating the secret resets every counter**, which costs at most an hour of limiting. Migration `0008_hash_auth_rate_limit_keys` deleted the rows written before it: the database does not hold the secret, so they could not be rewritten, and no hashed key could ever match one. The same addresses are still stored in `session.ip_address`, and Better Auth prunes rows older than its longest window, so the table holds about an hour of hashed history.

**It fails closed.** A counter that cannot be read rejects inside the router's `onRequest`, which better-call does not catch, so `createAuth` wraps `auth.handler` to answer that `DatabaseQueryFailed` — already stripped of bound values by `safeDatabaseAdapter` (#148) — with a bare 500, as every other database failure on the route is answered. Nothing is admitted; any other error is rethrown untouched.

### The sign-in form's rate limit

**The form accepts no more attempts from one client than the HTTP endpoint does** ([#180](https://github.com/joshstothard/3moji/issues/180)). Before any credential is evaluated — before the form is even read — `signInAction` asks `signInClientRateLimiter` (`packages/core/src/auth/sign-in-rate-limit.ts`), handing it the client address and nothing else. Beyond the limit it answers `rate-limited` without calling Better Auth: the form comes back as `/sign-in?error=rate-limited` and announces `Claim.signInRateLimited` in the same `role="alert"` live region as the other refusals, with no focus moved, like them. The boundary line (#156) records `rate-limited`.

| Limit              | Value                    | Constant                    |
| ------------------ | ------------------------ | --------------------------- |
| Per client address | 10 in a fixed 15 minutes | `SIGN_IN_CLIENT_RATE_LIMIT` |

**Derived from `AUTH_RATE_LIMITS.signInEmail`, not restated**, so tuning the endpoint tunes the form and the two cannot drift apart silently; `sign-in-rate-limit.test.ts` asserts the equality, converting Better Auth's seconds to milliseconds. **The numbers match; the window semantics do not.** Better Auth's counter resets a window after its last admitted request; this one is a fixed window on the shared counter table, so one client can make up to twenty attempts across a window boundary — the same price the Claim and resend pay for an atomic one-statement increment. It fits inside `RATE_LIMIT_RETENTION_MS` and prunes by it, so it never deletes another limiter's live counter.

**It reuses the Claim's table, store and hashing** under its own bucket kind, `sign-in-client:` and an HMAC of the address grouped by `clientAddressBucket` — IPv6 by `/64`, IPv4-mapped as IPv4, anything unreadable in the shared `unknown` bucket — exactly as the Claim's and resend's limiters identify a client.

**A refusal cannot enumerate addresses or confirm a password.** Nothing about the submission but the client address reaches the limiter, so a registered and an unregistered address, a right and a wrong password, are counted and refused identically, and a correct password beyond the limit is refused exactly as a wrong one. `sign-in-rate-limit.test.tsx` compares all four combinations beyond the limit — the action's answer, the redirect, the boundary line, the rendered page, its announcement and focus — after proving the four differ below it. **There is no response floor, and none is needed:** no credential-dependent work runs before the decision, so its timing depends on the client alone, which is the argument `disabledPaths` rests on (above). The refusal says no "when": the form works without JavaScript, so a "when" would travel in the query string, and a single "wait a few minutes" says what a person needs.

**It fails closed.** A store that cannot be read or written makes `admit` reject; the action catches that in its own `try` — separate from the credentials one, which reads any throw as a wrong password — logs it through `logFailure` (`sign_in_rate_limit_failed`) and answers `failed`. The adapter's error is already `DatabaseQueryFailed`, carrying a code and no bound values (#144).

#### Per-account limiting: not implemented, for the repo owner to decide

The per-client limit does nothing about **distributed** guessing: many clients, each under its limit, all guessing one Account's password. A per-Account limit — keyed on the normalised address (`normaliseEmailAddress`), counted before credentials so it too cannot enumerate — would slow that. **It is deliberately left out**, and flagged on the pull request, because:

- **It hands anyone a lock-out.** Whoever knows an address can spend its allowance from anywhere and keep its owner out of their own Account, for as long as they care to. The Claim's per-email limit accepts that cost because it bounds something worse — mail sent to a third party who never asked for it. Sign-in sends nothing, so a per-Account limit buys only slower distributed guessing, and the price is a denial of service on the person the limit is meant to protect.
- **It would make the refusal harder to keep honest.** With one limit, the refusal depends on the client alone. With two, it depends on the Account too, and every answer about the refusal — its wording, any "when" — has to be checked for revealing which bound; the Claim's `ClaimAdmission` carries no "when" for exactly that reason.
- **Better Auth's own endpoint does not do it either**: its limiter keys on client and path, so a per-Account limit on the form alone would make the form stricter than the endpoint beside it.

**What would change the decision:** evidence of distributed low-and-slow guessing in the boundary logs, which a pre-launch site cannot have. If it is added, it should be a separate constant with a conservative value, counted on every attempt (so a refusal cannot tell which limit bound), and paired with a way for the owner to get back in that does not depend on the limit — a password reset, which is separately limited.

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

| Table                   | Holds                                                                                                                                                                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user`                  | Identity: name, unique email, `email_verified`, timestamps                                                                                                                                                                       |
| `session`               | A session row per sign-in: unique token, expiry, IP, user agent, cascading to `user`                                                                                                                                             |
| `account`               | One row per auth method. For email and password, `provider_id = "credential"` and the hashed password lives in `account.password`. Cascades to `user`                                                                            |
| `verification`          | Better Auth's own token table. **Password-reset tokens only in practice**, keyed `reset-password:<token>`: email verification is a stateless JWT it never stores                                                                 |
| `verification_dispatch` | One row per verification link _we_ issued — the fingerprint, the Account and the time. Ours, not Better Auth's; see [the data model](data-model.md#verification-dispatch)                                                        |
| `auth_rate_limit`       | Better Auth's rate-limit counters, one per client address and path, under a keyed hash (#158, #214, migrations `0007_auth_rate_limit` and `0008_hash_auth_rate_limit_keys`); see [the data model](data-model.md#auth-rate-limit) |

**The Drizzle property keys are load-bearing.** Better Auth's adapter looks a table up by model name and addresses columns by the Drizzle property key, so renaming one breaks authentication at runtime rather than at build time. `schema.test.ts` calls Better Auth's own `getAuthTables()` and asserts our tables against it, so an upstream change that adds a column fails a test instead of production.

Database column names are snake_case and free to differ from the property keys, because the adapter never sees them.
