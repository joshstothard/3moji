/**
 * @jest-environment node
 */
interface AuthDeps {
  readonly emailSender: unknown;
  readonly baseUrl: string;
  readonly secret: string;
  readonly from: string;
  readonly plugins: readonly { readonly id: string }[];
}
interface CoreDeps {
  readonly clock: unknown;
  readonly db: unknown;
  readonly auth: AuthDeps;
}

const createDatabase = jest.fn((input: { url: string }) => ({
  db: "THE-DB",
  driver: "node-postgres" as const,
  close: jest.fn(),
  input,
}));
const createResendEmailSender = jest.fn(
  (_input: { apiKey: string; from: string }) => "THE-SENDER",
);
const createSystemClock = jest.fn(() => ({ now: () => new Date(0) }));
const createCoreServices = jest.fn((deps: CoreDeps) => ({ deps }));

// packages/core pulls in ESM-only dependencies that cannot be required under
// this suite. Mocking it is also the right boundary: this module's only job is
// to read the environment and hand the values over, and that is what is asserted.
jest.mock("@template/core", () => ({
  createDatabase: (input: { url: string }) => createDatabase(input),
  createResendEmailSender: (input: { apiKey: string; from: string }) =>
    createResendEmailSender(input),
  createSystemClock: () => createSystemClock(),
  createCoreServices: (deps: CoreDeps) => createCoreServices(deps),
}));
jest.mock("better-auth/next-js", () => ({
  nextCookies: () => ({ id: "next-cookies-plugin" }),
}));

const ENV = {
  DATABASE_URL: "postgresql://app:app@localhost:5432/app_test",
  BETTER_AUTH_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "a".repeat(32),
  RESEND_API_KEY: "re_test_key",
  RESEND_FROM: "3moji <no-reply@mail.3moji.me>",
} as const;

type EnvKey = keyof typeof ENV;
const KEYS = Object.keys(ENV) as EnvKey[];
const saved = new Map<EnvKey, string | undefined>();

function setEnv(values: Partial<Record<EnvKey, string>>): void {
  for (const key of KEYS) {
    const value = values[key];
    if (value === undefined) Reflect.deleteProperty(process.env, key);
    else process.env[key] = value;
  }
}

async function loadFresh() {
  jest.resetModules();
  return import("./services");
}

/** The dependencies the composition root was handed on its only call. */
function recordedDeps(): CoreDeps {
  const deps = createCoreServices.mock.calls[0]?.[0];
  if (deps === undefined) {
    throw new Error("createCoreServices was never called");
  }
  return deps;
}

describe("getServices", () => {
  beforeAll(() => {
    for (const key of KEYS) saved.set(key, process.env[key]);
  });

  afterEach(() => {
    jest.clearAllMocks();
    for (const key of KEYS) {
      const value = saved.get(key);
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = value;
    }
  });

  it("passes the connection string to the database factory", async () => {
    setEnv(ENV);
    const { getServices } = await loadFresh();

    getServices();

    expect(createDatabase.mock.calls[0]?.[0].url).toBe(ENV.DATABASE_URL);
  });

  it("passes the Resend key and sender to the email adapter", async () => {
    setEnv(ENV);
    const { getServices } = await loadFresh();

    getServices();

    expect(createResendEmailSender.mock.calls[0]?.[0]).toEqual({
      apiKey: ENV.RESEND_API_KEY,
      from: ENV.RESEND_FROM,
    });
  });

  it("hands the composition root the auth settings", async () => {
    setEnv(ENV);
    const { getServices } = await loadFresh();

    getServices();
    const { auth, db } = recordedDeps();

    // The client is a single top-level dependency, not one field inside `auth`:
    // Better Auth's adapter and the Handle repository must talk to the same
    // database, and two fields that could hold different clients would make
    // that an accident rather than an invariant.
    expect(db).toBe("THE-DB");
    expect(auth).not.toHaveProperty("db");
    expect(auth.emailSender).toBe("THE-SENDER");
    expect(auth.baseUrl).toBe(ENV.BETTER_AUTH_URL);
    expect(auth.secret).toBe(ENV.BETTER_AUTH_SECRET);
    expect(auth.from).toBe(ENV.RESEND_FROM);
  });

  it("supplies the Next.js cookie plugin, which packages/core cannot import", async () => {
    setEnv(ENV);
    const { getServices } = await loadFresh();

    getServices();

    expect(recordedDeps().auth.plugins).toEqual([
      { id: "next-cookies-plugin" },
    ]);
  });

  it("builds once and reuses it", async () => {
    setEnv(ENV);
    const { getServices } = await loadFresh();

    expect(getServices()).toBe(getServices());
    expect(createCoreServices).toHaveBeenCalledTimes(1);
  });

  it.each(KEYS)("throws naming %s when it is missing", async (missing) => {
    setEnv({ ...ENV, [missing]: undefined });
    const { getServices } = await loadFresh();

    expect(() => getServices()).toThrow(missing);
  });

  it("treats an empty value as missing", async () => {
    setEnv({ ...ENV, BETTER_AUTH_SECRET: "" });
    const { getServices } = await loadFresh();

    expect(() => getServices()).toThrow("BETTER_AUTH_SECRET");
  });

  it("does not build at import time, so next build needs no environment", async () => {
    setEnv({});

    // Importing must not throw with nothing configured; only calling does.
    await expect(loadFresh()).resolves.toBeDefined();
    expect(createCoreServices).not.toHaveBeenCalled();
  });
});
