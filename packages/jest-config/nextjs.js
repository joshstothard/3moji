const base = require("./base.js");

/** @type {import('jest').Config} */
const config = {
  ...base,
  testEnvironment: "jsdom",
  testRegex: ".*\\.test\\.tsx?$",
  transform: {
    "^.+\\.(ts|tsx)$": [
      "ts-jest",
      {
        useESM: false,
        tsconfig: { strict: true, jsx: "react-jsx" },
      },
    ],
  },
  moduleNameMapper: {
    ...base.moduleNameMapper,
    // Next.js layouts import global CSS, which Jest cannot parse.
    "\\.(css|less|sass|scss)$": require.resolve("./style-mock.js"),
  },
  transformIgnorePatterns: ["/node_modules/(?!(next-intl|use-intl)/)"],
};

module.exports = config;
