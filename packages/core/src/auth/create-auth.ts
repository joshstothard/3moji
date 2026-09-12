import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth, type BetterAuthOptions } from "better-auth";

import type { Database } from "../db/client";
import { authSchema } from "../db/schema";
import type { EmailSender } from "./ports/email-sender";

/** Better Auth's own minimum is 32 characters of randomness. */
const MINIMUM_SECRET_LENGTH = 32;

export interface CreateAuthInput {
  readonly db: Database;
  readonly emailSender: EmailSender;
  /** Where the app is served from; Better Auth builds its links from this. */
  readonly baseUrl: string;
  /** Signing secret. Passed in; never read from the environment here. */
  readonly secret: string;
  /** The verified sender address used for transactional mail. */
  readonly from: string;
  /**
   * Transport-specific plugins supplied by the application.
   *
   * `apps/web` passes `nextCookies()` here. It cannot be added inside this
   * package: it comes from `better-auth/next-js`, and ADR-0006 decision 2 keeps
   * `packages/core` free of framework imports — a rule its ESLint config
   * enforces. Accepting plugins from the caller is what lets the boundary hold
   * without giving up the plugin.
   */
  readonly plugins?: NonNullable<BetterAuthOptions["plugins"]>;
}

/**
 * Builds the Better Auth instance.
 *
 * Three of these settings are load-bearing for the product rather than
 * defaults worth accepting, and ADR-0006 decision 5 names them:
 *
 * - `requireEmailVerification` makes the verification gate real: sign-up
 *   returns no session and sign-in is refused until the address is confirmed.
 * - `autoSignInAfterVerification` is **not** a default. Without it, following
 *   the verification link verifies the account and then drops the user at a
 *   sign-in page instead of the Profile they just claimed.
 * - `revokeSessionsOnPasswordReset` destroys existing sessions on reset.
 *
 * A successful password reset deliberately does **not** mark the email
 * verified, even though it proves control of the address, so that the claim
 * gate has exactly one meaning (#15).
 */
export function createAuth(input: CreateAuthInput) {
  if (input.secret.length < MINIMUM_SECRET_LENGTH) {
    throw new Error(
      `createAuth requires a secret of at least ${String(MINIMUM_SECRET_LENGTH)} characters. Generate one randomly; a short secret is brute-forceable.`,
    );
  }
  if (input.baseUrl === "") {
    throw new Error(
      "createAuth requires a base URL. Better Auth builds verification and reset links from it, so an empty value produces unusable emails.",
    );
  }

  const { emailSender, from } = input;

  return betterAuth({
    secret: input.secret,
    baseURL: input.baseUrl,
    database: drizzleAdapter(input.db, {
      provider: "pg",
      schema: authSchema,
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await emailSender.send({
          to: user.email,
          subject: "Reset your 3moji password",
          // The token travels in the URL only, never the subject: subjects are
          // logged and previewed far more widely than bodies.
          text: `Reset your password: ${url}\n\nIf you did not ask for this, ignore this email and nothing will change.\n\nFrom ${from}`,
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await emailSender.send({
          to: user.email,
          subject: "Verify your email to claim your 3moji handle",
          text: `Verify your email: ${url}\n\nYour handle is held for 24 hours while you do. After that it returns to the pool.\n\nFrom ${from}`,
        });
      },
    },
    ...(input.plugins === undefined ? {} : { plugins: input.plugins }),
  });
}
