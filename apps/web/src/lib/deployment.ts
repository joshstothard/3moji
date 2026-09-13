/**
 * Whether this process is a deployment that real people use.
 *
 * `NODE_ENV` is `production` under `next start` and on every Vercel
 * deployment; `VERCEL_ENV` is set on every Vercel deployment, previews
 * included. Either is enough.
 *
 * It exists to **refuse** test-only switches — `TEST_EMAIL_SENDER` in
 * `lib/services.ts` (#151) and `TEST_ERROR_ROUTE` in `lib/test-error-route.ts`
 * (#203) — and never to select a code path: `NODE_ENV` choosing behaviour is
 * what ADR-0010 removed, because it let CI exercise something production never
 * ran. It takes the environment as an argument so each rule is tested without
 * mutating `process.env`.
 */
export function isDeployed(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  const vercelEnv = env.VERCEL_ENV;
  return (
    env.NODE_ENV === "production" ||
    (vercelEnv !== undefined && vercelEnv !== "")
  );
}
