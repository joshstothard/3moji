import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./schema";

/**
 * One verification link we issued: who for, when, and which link it was.
 *
 * **This table exists because Better Auth's verification token is stateless.**
 * `createEmailVerificationToken` signs a JWT carrying the address and an hour's
 * expiry, and stores nothing — so there is no row to delete, and "each resend
 * invalidates the previous link" ([#82](https://github.com/joshstothard/3moji/issues/82))
 * is not something the library can be configured into. Every token it signs
 * stays valid until it expires. Recording what we issued is the only way to
 * know which link is the newest, and therefore the only way to refuse an older
 * one.
 *
 * It carries the resend rate limit too, and that is not two responsibilities
 * bolted together: "three an hour, at most one a minute, per Account" is a
 * question about the same facts — the times this Account's links went out. A
 * serverless deployment has no process memory to hold them in
 * ([ADR-0006](../../../../docs/adr/0006-nextjs-on-vercel-is-the-whole-application.md)),
 * so they have to be rows.
 *
 * Rows are evidence rather than an invariant: they are written by the
 * `sendVerificationEmail` hook, which is the one place Better Auth tells us a
 * token was issued. On the claim path that hook runs inside the claim
 * transaction, so a rolled-back Claim leaves no dispatch behind, exactly as it
 * leaves no Account.
 */
export const verificationDispatch = pgTable(
  "verification_dispatch",
  {
    id: text("id").primaryKey(),
    /**
     * The Account the link was issued to. `ON DELETE CASCADE`, so an expired
     * unverified Account ([#83](https://github.com/joshstothard/3moji/issues/83))
     * and a Release both take their dispatch history with them — this table
     * must never be the reason a deleted Account leaves a trace.
     */
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /**
     * SHA-256 of the token, hex-encoded — **never the token itself**, which is
     * a bearer credential good for an hour. See
     * {@link ../auth/verification-token.verificationTokenFingerprint}.
     *
     * **Deliberately not `UNIQUE`.** Better Auth's JWT carries `iat` at
     * one-second resolution and no nonce, so two tokens signed for the same
     * address within the same second are byte-identical. The one-a-minute floor
     * makes that unreachable through the product, but a unique index would turn
     * any future path that sends twice quickly into a constraint violation on a
     * bookkeeping row — a hard failure in exchange for nothing, since duplicate
     * rows here are indistinguishable from each other anyway.
     */
    tokenHash: text("token_hash").notNull(),
    /**
     * When the link went out, from the injected `Clock` rather than a SQL
     * default: the rate-limit window is a domain rule, and `defaultNow()` would
     * put it where no test can move time — the same argument
     * `handle.held_until` makes.
     */
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    /** The lookup a followed link performs: fingerprint to Account. */
    index("verification_dispatch_token_hash_idx").on(table.tokenHash),
    /**
     * The lookup the rate limit and the freshness check perform. Descending on
     * `sent_at`, because both want the newest rows of one Account.
     */
    index("verification_dispatch_user_sent_at_idx").on(
      table.userId,
      table.sentAt.desc(),
    ),
  ],
);
