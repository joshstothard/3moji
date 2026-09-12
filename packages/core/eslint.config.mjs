import baseConfig from "@template/eslint-config";

// ADR-0006 decision 2: packages/core is framework-free. Route handlers and
// server actions are thin adapters over it, so a future NestJS API can call
// the same use cases unchanged. That boundary is only real if something
// enforces it — this is that something.
const frameworkFreeBoundary = {
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["next", "next/*"],
            message:
              "packages/core is framework-free (ADR-0006). Keep Next.js in apps/web.",
          },
          {
            group: ["react", "react-dom", "react/*", "react-dom/*"],
            message:
              "packages/core is framework-free (ADR-0006). Keep React in apps/web or packages/ui.",
          },
          {
            group: ["@vercel/*"],
            message:
              "packages/core must not depend on Vercel primitives (ADR-0006, reversibility condition 5).",
          },
        ],
      },
    ],
    // `no-restricted-imports` inspects import statements only, so a type-level
    // `typeof import("next/headers")` slips past it. Verified empirically, then
    // closed here against the TSImportType node.
    "no-restricted-syntax": [
      "error",
      {
        selector:
          "TSImportType[source.value=/^(next|react|react-dom|@vercel)(\\/|$)/]",
        message:
          "packages/core is framework-free (ADR-0006). This applies to type-level imports too.",
      },
    ],
  },
};

export default [...baseConfig, frameworkFreeBoundary];
