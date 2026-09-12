import base from "@template/jest-config/base";

/** @type {import('jest').Config} */
const config = {
  ...base,
  testEnvironment: "node",
};

export default config;
