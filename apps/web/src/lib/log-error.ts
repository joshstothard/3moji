/**
 * How a failure on a path that handles personal data reaches the logs (#134).
 *
 * **Never the message.** The message of a thrown error is free text written by
 * whatever threw it — Better Auth, the `pg` driver through Drizzle, the Resend
 * API — and it can quote the values involved: a Postgres unique violation reads
 * `Key (email)=(someone@example.com) already exists`, and a Resend rejection
 * carries a slice of Resend's own response body. So a log line built from it
 * can write somebody's email address into production logs, on exactly the
 * unexpected failures nobody reads carefully before they are retained.
 *
 * What is logged instead is a descriptor made only of values that **cannot**
 * carry free text: an identifier-shaped `name` and `code` that passed an
 * allow-list pattern, an HTTP status reduced to its three digits, and the name
 * of a missing environment variable chosen from a fixed list of literals. The
 * rule is recorded in `AGENTS.md` § Observability.
 *
 * **This lives in `apps/web`, not `packages/core`, on purpose.** Every caller
 * is here, and every web suite mocks `@template/core` wholesale — a helper
 * imported from there would be `undefined` inside the very catch blocks it
 * exists for, turning a graceful degradation into an unhandled rejection. The
 * cause walk below repeats the shape of core's `postgresErrorCode` for that
 * reason.
 */

/** What an operator sees in place of the message. */
export interface ErrorDescriptor {
  /** The error's class name, e.g. `DrizzleQueryError`, `APIError`, `Error`. */
  readonly name: string;
  /** A Postgres SQLSTATE, a Node system code, or a Better Auth error code. */
  readonly code?: string;
  /** An HTTP status, or Better Auth's status name such as `FORBIDDEN`. */
  readonly status?: string;
  /** The environment variable the failure names, when it is one we require. */
  readonly missing?: string;
  /** The class names down the `cause` chain, outermost first. */
  readonly causes?: readonly string[];
}

/**
 * Every variable `services.ts` requires. A test reads that file and fails if
 * the two drift, so a new variable cannot silently go back to an anonymous
 * `Error` in the logs.
 */
export const REQUIRED_VARIABLES: readonly string[] = [
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "DATABASE_URL",
  "RESEND_API_KEY",
  "RESEND_FROM",
];

const SAFE_NAME = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/;
const SAFE_CODE = /^[A-Z0-9_]{1,64}$/;
const SAFE_STATUS_NAME = /^[A-Z_]{1,32}$/;
const STATUS_IN_MESSAGE = /\bstatus (\d{3})\b/;
const MAX_CHAIN = 6;

function nameOf(error: object): string {
  const name = "name" in error ? error.name : undefined;
  return typeof name === "string" && SAFE_NAME.test(name)
    ? name
    : "UnrecognisedError";
}

function safeCode(value: unknown): string | undefined {
  return typeof value === "string" && SAFE_CODE.test(value) ? value : undefined;
}

function codeOf(error: object): string | undefined {
  const own = safeCode("code" in error ? error.code : undefined);
  if (own !== undefined) return own;
  // Better Auth's APIError keeps its stable code on the response body.
  if (
    !("body" in error) ||
    typeof error.body !== "object" ||
    error.body === null
  ) {
    return undefined;
  }
  return safeCode("code" in error.body ? error.body.code : undefined);
}

function messageOf(error: object): string | undefined {
  const message = "message" in error ? error.message : undefined;
  return typeof message === "string" ? message : undefined;
}

function statusOf(error: object): string | undefined {
  const status = "status" in error ? error.status : undefined;
  if (
    typeof status === "number" &&
    Number.isInteger(status) &&
    status >= 100 &&
    status <= 599
  ) {
    return String(status);
  }
  if (typeof status === "string" && SAFE_STATUS_NAME.test(status)) {
    return status;
  }
  // The Resend adapter states the status only in its message. The capture is
  // three digits, so nothing else from that message can come with it.
  return STATUS_IN_MESSAGE.exec(messageOf(error) ?? "")?.[1];
}

function missingOf(error: object): string | undefined {
  const message = messageOf(error);
  if (message === undefined) return undefined;
  // The literal from the list is what is returned, never text from the message.
  return REQUIRED_VARIABLES.find((variable) => message.includes(variable));
}

/** The error and its causes, stopping at a loop or an implausible depth. */
function chainOf(error: object): readonly object[] {
  const chain: object[] = [];
  let current: unknown = error;
  while (
    typeof current === "object" &&
    current !== null &&
    !chain.includes(current) &&
    chain.length < MAX_CHAIN
  ) {
    chain.push(current);
    current = "cause" in current ? current.cause : undefined;
  }
  return chain;
}

function firstOf(
  chain: readonly object[],
  read: (error: object) => string | undefined,
): string | undefined {
  for (const link of chain) {
    const found = read(link);
    if (found !== undefined) return found;
  }
  return undefined;
}

function describe(error: unknown): ErrorDescriptor {
  if (typeof error !== "object" || error === null) {
    // A thrown string is free text too, so it is not repeated either.
    return { name: "NonErrorThrown" };
  }
  const chain = chainOf(error);
  const code = firstOf(chain, codeOf);
  const status = firstOf(chain, statusOf);
  const missing = firstOf(chain, missingOf);
  const causes = chain.slice(1).map(nameOf);
  return {
    name: nameOf(error),
    ...(code === undefined ? {} : { code }),
    ...(status === undefined ? {} : { status }),
    ...(missing === undefined ? {} : { missing }),
    ...(causes.length === 0 ? {} : { causes }),
  };
}

/**
 * A log-safe descriptor of an unknown thrown value. It never throws: it runs
 * only inside catch blocks, where a second failure would replace the graceful
 * answer the catch exists to give.
 */
export function describeError(error: unknown): ErrorDescriptor {
  try {
    return describe(error);
  } catch {
    return { name: "UndescribableError" };
  }
}

/**
 * Log a failure as one structured JSON line: the `event` that log-based
 * alerting keys on, and the {@link describeError} descriptor under `error`.
 */
export function logFailure(event: string, error: unknown): void {
  console.error(JSON.stringify({ event, error: describeError(error) }));
}
