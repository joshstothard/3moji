import {
  createCoreServices,
  createDatabase,
  createResendEmailSender,
  createSystemClock,
  type CoreServices,
} from "@template/core";
import { nextCookies } from "better-auth/next-js";

/**
 * The application's composition point.
 *
 * ADR-0006 decision 4: dependencies are wired by a manual composition root, not
 * a container. This module reads the environment — the one place that does —
 * and hands the values to `packages/core`, which never reads it itself.
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

function build(): CoreServices {
  const { db } = createDatabase({
    url: required("DATABASE_URL"),
    nodeEnv: process.env.NODE_ENV,
  });

  return createCoreServices({
    clock: createSystemClock(),
    auth: {
      db,
      emailSender: createResendEmailSender({
        apiKey: required("RESEND_API_KEY"),
        from: required("RESEND_FROM"),
      }),
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
