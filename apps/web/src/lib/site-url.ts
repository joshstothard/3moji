/**
 * The address the app is served from, as configured for this deployment (#32).
 *
 * **Outside a Vercel preview it is `BETTER_AUTH_URL`**, unchanged.
 *
 * **On a preview (`VERCEL_ENV=preview`) it is the deployment's own address**:
 * `https://` and `VERCEL_BRANCH_URL`, or `VERCEL_URL` when there is no branch
 * URL. `BETTER_AUTH_URL` is the production address in every Vercel
 * environment, so reading it on a preview would email verification and reset
 * links that open production, whose database is not the preview's Neon branch
 * and so holds none of the preview's tokens. The branch URL is preferred
 * because it stays the same across redeploys of one branch, and a preview's
 * database branch belongs to the git branch too.
 *
 * **A preview with neither is `undefined`, never the production address**, and
 * a host carrying anything but letters, digits, dots and hyphens is refused,
 * so a scheme, a path or a user can never be spliced in.
 *
 * Better Auth's origin check needs no preview entry: it runs only on HTTP
 * requests to `/api/auth`, and this app reaches auth through server-side
 * `auth.api.*` calls, which have no request to check.
 *
 * It takes the environment as an argument so each rule is tested without
 * mutating `process.env`, like `isDeployed` in `lib/deployment.ts`.
 */
const PREVIEW_HOST = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/i;

function valueOf(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined {
  const value = env[name];
  return value === undefined || value === "" ? undefined : value;
}

export function configuredSiteUrl(
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  if (env.VERCEL_ENV !== "preview") return valueOf(env, "BETTER_AUTH_URL");

  const host = valueOf(env, "VERCEL_BRANCH_URL") ?? valueOf(env, "VERCEL_URL");
  if (host === undefined || !PREVIEW_HOST.test(host)) return undefined;
  return `https://${host}`;
}
