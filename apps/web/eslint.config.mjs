import nextjsConfig from "@template/eslint-config/nextjs";

/**
 * Modules that read who is signed in. Importing one makes whatever imports it
 * render per visitor.
 */
const SESSION_READERS = [
  {
    group: ["**/lib/session", "**/lib/profile-edit", "**/lib/viewer"],
    message:
      "Shared chrome and the public Profile must not read the session: it would make every page per-visitor and break the Profile's identical HTML (#193). Ask GET /api/viewer from a client island instead; see docs/architecture/auth.md § Reading the session.",
  },
];

export default [
  ...nextjsConfig,
  {
    /*
     * **The public Profile's HTML is the same bytes for every visitor, and this
     * is what keeps it so** (#193). The root layout and the navbar wrap every
     * page, and the Handle route is the most-read page in the product; if any
     * of them read the session, every response would differ by visitor. The
     * signed-in indicator asks `GET /api/viewer` after hydration instead.
     *
     * `next/headers` is refused too: it is how a session is read, and nothing
     * in these files needs a request header.
     */
    files: [
      "src/app/layout.tsx",
      "src/app/[[]handle]/page.tsx",
      "src/components/navbar.tsx",
      "src/components/account-menu.tsx",
      "src/components/header-search.tsx",
      "src/components/site-analytics.tsx",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "next/headers",
              message:
                "Shared chrome and the public Profile must not read request headers or the session (#193); see docs/architecture/auth.md § Reading the session.",
            },
          ],
          patterns: SESSION_READERS,
        },
      ],
    },
  },
];
