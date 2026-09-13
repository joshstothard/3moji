// The audited facts behind `HTTP_DISABLED_AUTH_PATHS` in
// `packages/core/src/auth/create-auth.ts` (#150, #169). The one place they are
// written down: `scripts/better-auth-audit.test.mjs` fails the build when the
// installed tree or the application's source stops matching them, and the code
// comment points here instead of repeating them.
//
// Update this file only as the last step of the recheck in
// docs/architecture/auth.md § Rechecking the Account-creation audit — never to
// turn a failing check green without doing it.

export const RECHECK =
  "Recheck the Account-creation audit before changing anything: docs/architecture/auth.md § Rechecking the Account-creation audit (#169). Update scripts/better-auth-audit.mjs only once the recheck is done.";

export const AUDIT = Object.freeze({
  /** The versions the audit was made against. Every installed copy must match. */
  versions: Object.freeze({
    "better-auth": "1.7.4",
    "@better-auth/core": "1.7.4",
    "@better-auth/drizzle-adapter": "1.7.4",
  }),

  /** Must equal the `HTTP_DISABLED_AUTH_PATHS` literal in create-auth.ts. */
  httpDisabledPaths: Object.freeze(["/sign-up/email", "/sign-in/social"]),

  /**
   * Every occurrence of a `create…User…` identifier (or string) in the
   * installed runtime JavaScript of `better-auth` and `@better-auth/*`, as
   * `package → file → identifier → count`. The reachability note on each file
   * is the audit's conclusion about it; the counts are what the test compares.
   */
  userCreationTokens: Object.freeze({
    "better-auth": Object.freeze({
      // The two user-writing methods. `createOAuthUser` has no caller.
      "dist/db/internal-adapter.mjs": { createOAuthUser: 1, createUser: 1 },
      // POST /sign-up/email: disabled over HTTP; the Claim calls it server-side.
      "dist/api/routes/sign-up.mjs": { createUser: 1 },
      // handleOAuthUserInfo: /sign-in/social (disabled), /callback/:id (needs
      // state from /sign-in/social or a signed-in /link-social), and the
      // one-tap and oauth-proxy plugins (not configured).
      "dist/oauth2/link-account.mjs": { createUser: 1 },
      // Plugins: inert unless configured, which the plugin check guards.
      "dist/plugins/admin/admin.mjs": { createUser: 3 },
      "dist/plugins/admin/routes.mjs": {
        createUser: 6,
        createUserBodySchema: 2,
      },
      "dist/plugins/anonymous/index.mjs": { createUser: 1 },
      "dist/plugins/email-otp/routes.mjs": { createUser: 1 },
      "dist/plugins/magic-link/index.mjs": { createUser: 1 },
      "dist/plugins/phone-number/routes.mjs": { createUser: 1 },
      "dist/plugins/siwe/index.mjs": { createSIWEUser: 3, createUser: 1 },
      "dist/plugins/test-utils/db-helpers.mjs": {
        createDeleteUser: 2,
        createSaveUser: 2,
        createUser: 1,
      },
      "dist/plugins/test-utils/factories.mjs": { createUserFactory: 2 },
      "dist/plugins/test-utils/index.mjs": {
        createDeleteUser: 2,
        createSaveUser: 2,
        createUser: 2,
        createUserFactory: 2,
      },
      // Test harness export; not reachable from an HTTP request.
      "dist/test-utils/test-instance.mjs": { createTestUser: 2 },
    }),
  }),

  /**
   * Every direct write of the `user` model — `createWithHooks(…, "user", …)`
   * or `create({ model: "user" })` — as `package → file → count`. This is what
   * catches a new sibling of `createUser` under a name the token scan misses.
   */
  userModelWrites: Object.freeze({
    "better-auth": Object.freeze({ "dist/db/internal-adapter.mjs": 2 }),
  }),

  /**
   * Every `better-auth` / `@better-auth/*` import specifier in non-test source
   * under apps/ and packages/, as `file → specifiers`. A plugin arrives as a
   * new specifier (`better-auth/plugins`, `@better-auth/passkey`, …).
   */
  sourceImports: Object.freeze({
    "apps/web/src/app/api/auth/[...all]/route.ts": ["better-auth/next-js"],
    "apps/web/src/lib/services.ts": ["better-auth/next-js"],
    "packages/core/src/auth/create-auth.ts": [
      "@better-auth/drizzle-adapter",
      "better-auth",
    ],
    "packages/core/src/auth/safe-database-adapter.ts": ["better-auth/types"],
  }),

  /**
   * Every `plugins` option in non-test source, as `file → values`, with
   * whitespace removed. `nextCookies()` only sets cookies on responses and adds
   * no endpoint; `input.plugins` is createAuth passing its caller's list on.
   */
  pluginOptions: Object.freeze({
    "apps/web/src/lib/services.ts": ["[nextCookies()]"],
    "packages/core/src/auth/create-auth.ts": ["input.plugins"],
  }),
});
