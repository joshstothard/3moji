/**
 * Which Drizzle driver to talk to Postgres through.
 *
 * ADR-0006 decision 6 puts production on Neon's serverless HTTP driver, which
 * suits short-lived serverless invocations. Local development and CI run a
 * plain Postgres (CI provides a `postgres:16` service), which needs a TCP
 * connection instead. One schema, one set of migrations, one place that knows
 * the difference.
 */
export type DatabaseDriver = "node-postgres" | "neon-http";

const DRIVERS: readonly DatabaseDriver[] = ["node-postgres", "neon-http"];

export interface ResolveDriverInput {
  /** The value of `NODE_ENV`, passed in rather than read here. */
  readonly nodeEnv: string | undefined;
  /** Forces a driver, whatever the environment says. */
  readonly override?: DatabaseDriver | undefined;
}

/**
 * Nothing here reads `process.env`. The domain must not depend on ambient
 * state, so the caller supplies the environment and tests supply a fake one.
 */
export function resolveDriver(input: ResolveDriverInput): DatabaseDriver {
  const { nodeEnv, override } = input;

  if (override !== undefined) {
    if (!DRIVERS.includes(override)) {
      throw new Error(
        `Unknown database driver "${override}". Expected one of: ${DRIVERS.join(", ")}.`,
      );
    }
    return override;
  }

  return nodeEnv === "production" ? "neon-http" : "node-postgres";
}
