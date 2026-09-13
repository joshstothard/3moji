/**
 * The only database error that leaves a `packages/core` adapter
 * ([#144](https://github.com/joshstothard/3moji/issues/144)).
 *
 * drizzle-orm 0.45.2 reports a failed statement as a `DrizzleQueryError` built
 * as `` `Failed query: ${query}\nparams: ${params}` `` — so its message repeats
 * every bound value — and it keeps `query` and `params` as own enumerable
 * properties, so `JSON.stringify` repeats them again. Its `cause` is the `pg`
 * error, whose `detail` reads `Key (email)=(someone@example.com) already
 * exists.` for exactly the failure the Claim sees most. An error tracker
 * captures `message`, `stack`, own properties and the whole `cause` chain by
 * default, so that error would send an email address, a password-adjacent
 * sign-up or a Profile's text to a third party.
 *
 * This error carries only what cannot hold free text: the code and the
 * constraint name, each checked against an identifier-shaped pattern, and a
 * message built from nothing else. It has **no `cause`** — keeping the original
 * "just for the SQLSTATE" would keep the leak with it.
 *
 * `code` is exactly what {@link ./postgres-error.postgresErrorCode} would have
 * found on the original: the SQLSTATE for a rejected statement (`23505`), or a
 * Node system code for a connection that never opened (`ECONNREFUSED`). That is
 * what keeps the unique-violation branches, and `describeError`'s `code`,
 * working unchanged.
 */
export class DatabaseQueryFailed extends Error {
  /** A Postgres SQLSTATE or a Node system code. Absent when none was found. */
  readonly code: string | undefined;
  /** The constraint Postgres named, e.g. `user_email_unique`. */
  readonly constraint: string | undefined;

  constructor(code: string | undefined, constraint: string | undefined) {
    super(
      code === undefined
        ? "A database query failed."
        : `A database query failed with code ${code}.`,
    );
    this.name = "DatabaseQueryFailed";
    this.code = code;
    this.constraint = constraint;
  }
}

/** SQLSTATEs are five of `[0-9A-Z]`; Node system codes are `E` + capitals. */
const SAFE_CODE = /^[A-Z0-9_]{1,64}$/;
/** A Postgres identifier, as drizzle-kit names constraints. */
const SAFE_CONSTRAINT = /^[A-Za-z_][A-Za-z0-9_$]{0,62}$/;
const MAX_CHAIN = 8;

function readString(link: object, key: string): string | undefined {
  const value: unknown = Reflect.get(link, key);
  return typeof value === "string" ? value : undefined;
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

/**
 * Whether one link is something the database layer raised.
 *
 * **By shape, not by class.** `DrizzleQueryError` never sets `name` (it reads
 * `Error`), and `instanceof` against a library class is unreliable under
 * `--experimental-vm-modules`, where a class raised inside a dependency can
 * belong to another realm. What identifies each is what it carries:
 *
 * - drizzle-orm's `DrizzleQueryError` owns `query` and `params`;
 * - `pg`'s `DatabaseError` owns `severity`, set from every error Postgres
 *   returns.
 */
function isDatabaseLink(link: object): boolean {
  return ("query" in link && "params" in link) || "severity" in link;
}

/**
 * The error as it may leave an adapter: a {@link DatabaseQueryFailed} if the
 * database layer raised it, or the original untouched if it did not.
 *
 * **Anything that is not a database error passes through as it was.** Better
 * Auth's `APIError` keeps the `status` and `body.code` a caller reads, the
 * adapters' own rollback sentinels stay identifiable, and a pool that could not
 * connect at all rejects with Node's own error before any statement — and so
 * before any parameter — exists.
 */
export function toSafeDatabaseError(error: unknown): unknown {
  if (typeof error !== "object" || error === null) return error;
  if (error instanceof DatabaseQueryFailed) return error;

  const chain = chainOf(error);
  if (!chain.some(isDatabaseLink)) return error;

  let code: string | undefined;
  let constraint: string | undefined;
  for (const link of chain) {
    const linkCode = readString(link, "code");
    // The first string code down the chain, as `postgresErrorCode` reads it;
    // kept only if it is identifier-shaped.
    if (code === undefined && linkCode !== undefined) {
      code = SAFE_CODE.test(linkCode) ? linkCode : "UNRECOGNISED";
    }
    const linkConstraint = readString(link, "constraint");
    if (
      constraint === undefined &&
      linkConstraint !== undefined &&
      SAFE_CONSTRAINT.test(linkConstraint)
    ) {
      constraint = linkConstraint;
    }
  }
  return new DatabaseQueryFailed(code, constraint);
}

/**
 * Runs one adapter operation and rethrows any database error it raises as a
 * {@link DatabaseQueryFailed}. For the adapters with no transaction runner of
 * their own to catch in.
 */
export async function withSafeDatabaseErrors<T>(
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw toSafeDatabaseError(error);
  }
}
