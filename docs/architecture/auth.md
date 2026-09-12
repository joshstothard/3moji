# Authentication

**Partly built.** The tables and their migration exist in `packages/core`; the sign-in, verification and reset flows are not wired yet (#31). The shape is decided in [ADR-0006](../adr/0006-nextjs-on-vercel-is-the-whole-application.md).

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

## The gate on claiming

A Claim is final only once the Account's email is verified. The gate is a read of the verified flag on our own row.

The verification token expires in an hour while the Handle's hold lasts a day, so **resending is the ordinary path, not an edge case**. The expired-link page must make clear the Handle is still held.

A successful password reset does **not** mark the email verified, even though it proves control of the address. The two are kept separate so the Claim gate has exactly one meaning.

## Adjacent behaviour

Duplicate sign-ups return a synthetic success, so the API never reveals whether an address is registered. Because every live Account owns exactly one Handle, a duplicate address can never claim a second one; the existing owner is told by email instead.

Every email-sending endpoint is rate limited.

## The tables, as they exist today

Defined in `packages/core/src/db/schema.ts`, migrated by `packages/core/migrations/0000_auth_tables.sql`.

| Table          | Holds                                                                                                                                                 |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user`         | Identity: name, unique email, `email_verified`, timestamps                                                                                            |
| `session`      | A session row per sign-in: unique token, expiry, IP, user agent, cascading to `user`                                                                  |
| `account`      | One row per auth method. For email and password, `provider_id = "credential"` and the hashed password lives in `account.password`. Cascades to `user` |
| `verification` | Email-verification and password-reset tokens, by identifier and expiry                                                                                |

**The Drizzle property keys are load-bearing.** Better Auth's adapter looks a table up by model name and addresses columns by the Drizzle property key, so renaming one breaks authentication at runtime rather than at build time. `schema.test.ts` calls Better Auth's own `getAuthTables()` and asserts our tables against it, so an upstream change that adds a column fails a test instead of production.

Database column names are snake_case and free to differ from the property keys, because the adapter never sees them.
