/**
 * `unique_violation`. The SQLSTATE the `handle` table's primary key raises when
 * a Handle is claimed twice, and what ADR-0004 decision 7 means by "the
 * database constraint … decides a race between simultaneous claims".
 */
export const UNIQUE_VIOLATION = "23505";

/**
 * The Postgres error code an unknown rejection carries, or `undefined`.
 *
 * **It walks the `cause` chain, and that is not defensive padding.** A raw `pg`
 * client rejects with the driver's own error, which carries `code` directly;
 * everything issued through Drizzle rejects with a `DrizzleQueryError`, which
 * has no `code` of its own and keeps the driver error in `cause`. Reading only
 * the top level finds a code on the former and nothing on the latter — which is
 * what CI reported the first time the integration suite ran against a real
 * Postgres.
 *
 * `catch` gives `unknown` and the package forbids casting it into shape, so the
 * narrowing is spelled out. Code rather than message, because only the code
 * distinguishes a rejected insert from a connection drop or a typo in the SQL.
 */
export function postgresErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  if ("code" in error && typeof error.code === "string") {
    return error.code;
  }
  return "cause" in error ? postgresErrorCode(error.cause) : undefined;
}
