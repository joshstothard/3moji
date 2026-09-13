import {
  createCoreServices,
  createDatabase,
  createRecordingEmailSender,
  createResendEmailSender,
  createSystemClock,
  type CoreServices,
  type EmailSender,
} from "@template/core";
import { nextCookies } from "better-auth/next-js";

import { createAfterBackgroundTasks } from "./after-background-tasks";

/**
 * The application's composition point.
 *
 * ADR-0006 decision 4: dependencies are wired by a manual composition root, not
 * a container. This module reads the service environment — the five required
 * variables, and the one place that reads them to build services — and hands
 * the values to `packages/core`, which never reads it itself. The one other
 * reader is `lib/share-link.ts`, which takes the site origin from
 * `BETTER_AUTH_URL` for a link string that needs no services (#160).
 *
 * **Built lazily, on first use.** `next build` imports route handlers, and the
 * factories throw on a missing secret or connection string. Constructing at
 * module scope would therefore fail the build on any machine without a full
 * environment, including CI. Deferring to the first request keeps the build
 * honest while still failing loudly when a request actually needs a
 * misconfigured service.
 */
let cached: CoreServices | undefined;

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(
      `${name} is not set. It is required to serve authenticated requests; see apps/web/.env.example.`,
    );
  }
  return value;
}

/**
 * The one value of `TEST_EMAIL_SENDER` that means anything.
 *
 * Spelled out rather than read as a boolean, so `TEST_EMAIL_SENDER=false` or a
 * typo cannot be mistaken for either answer: an unrecognised value refuses to
 * start instead.
 */
const RECORDING_SENDER = "recording";

/**
 * Whether this process is a deployment that real people use.
 *
 * `NODE_ENV` is `production` under `next start` and on every Vercel
 * deployment; `VERCEL_ENV` is set on every Vercel deployment, previews
 * included. Either is enough to refuse: refusing a preview costs a failed
 * deploy, and not refusing costs verification email that silently never goes.
 */
function isDeployed(): boolean {
  const vercelEnv = process.env.VERCEL_ENV;
  return (
    process.env.NODE_ENV === "production" ||
    (vercelEnv !== undefined && vercelEnv !== "")
  );
}

/**
 * The transactional email sender: Resend, unless a test run asks otherwise.
 *
 * **`TEST_EMAIL_SENDER=recording` is a test-only switch, and production
 * refuses it** ([#151](https://github.com/joshstothard/3moji/issues/151)). It
 * lets CI's E2E job run the real app without sending mail through Resend. A
 * switch that turns email off is also a switch that turns verification into a
 * no-op, so it must not be reachable in production by misconfiguration: a
 * deployed process with it set throws here, at construction, rather than
 * starting quietly without email.
 *
 * **It is selected explicitly, never inferred.** A missing `RESEND_API_KEY`
 * still throws exactly as before, and every variable is still required with
 * the switch on, so the environment contract does not fork.
 *
 * `NODE_ENV` only ever *refuses* here; it never selects a code path. That is
 * the distinction from the driver ADR-0010 removed, which chose one by
 * `NODE_ENV` and so let CI exercise something production never ran.
 */
function emailSender(): EmailSender {
  const apiKey = required("RESEND_API_KEY");
  const from = required("RESEND_FROM");
  const selected = process.env.TEST_EMAIL_SENDER;

  if (selected === undefined || selected === "") {
    return createResendEmailSender({ apiKey, from });
  }

  if (selected !== RECORDING_SENDER) {
    throw new Error(
      `TEST_EMAIL_SENDER has an unrecognised value. The only accepted value is "${RECORDING_SENDER}"; unset it to send through Resend.`,
    );
  }

  if (isDeployed()) {
    throw new Error(
      "TEST_EMAIL_SENDER is set in a production environment. It selects a test-only sender that delivers no email, so the app refuses to start; unset it.",
    );
  }

  return createRecordingEmailSender();
}

function build(): CoreServices {
  // First, so a refused sender opens no connection pool.
  const sender = emailSender();

  const { db } = createDatabase({
    url: required("DATABASE_URL"),
    nodeEnv: process.env.NODE_ENV,
  });

  return createCoreServices({
    clock: createSystemClock(),
    db,
    // Every email goes out after the response, through Next.js's `after()`,
    // so no answer about an address waits on the provider or fails because of
    // it (#216). The other framework-specific piece, beside the cookie plugin.
    backgroundTasks: createAfterBackgroundTasks(),
    auth: {
      emailSender: sender,
      baseUrl: required("BETTER_AUTH_URL"),
      secret: required("BETTER_AUTH_SECRET"),
      from: required("RESEND_FROM"),
      // The only framework-specific piece. It cannot live in packages/core,
      // whose lint rules forbid importing next/*; createAuth accepts plugins
      // from the caller precisely so this boundary holds.
      plugins: [nextCookies()],
    },
  });
}

export function getServices(): CoreServices {
  cached ??= build();
  return cached;
}
