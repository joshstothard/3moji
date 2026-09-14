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
  readonly backgroundTasks: unknown;
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
const createRecordingEmailSender = jest.fn(() => "THE-RECORDING-SENDER");
const createSystemClock = jest.fn(() => ({ now: () => new Date(0) }));
const createCoreServices = jest.fn((deps: CoreDeps) => ({ deps }));

// packages/core pulls in ESM-only dependencies that cannot be required under
// this suite. Mocking it is also the right boundary: this module's only job is
// to read the environment and hand the values over, and that is what is asserted.
jest.mock("@template/core", () => ({
  createDatabase: (input: { url: string }) => createDatabase(input),
  createResendEmailSender: (input: { apiKey: string; from: string }) =>
    createResendEmailSender(input),
  createRecordingEmailSender: () => createRecordingEmailSender(),
  createSystemClock: () => createSystemClock(),
  createCoreServices: (deps: CoreDeps) => createCoreServices(deps),
}));
jest.mock("better-auth/next-js", () => ({
  nextCookies: () => ({ id: "next-cookies-plugin" }),
}));
const createAfterBackgroundTasks = jest.fn(() => "THE-BACKGROUND-TASKS");
jest.mock("./after-background-tasks", () => ({
  createAfterBackgroundTasks: () => createAfterBackgroundTasks(),
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

  it("wires Next.js's after(), so no answer waits on the email provider (#216)", async () => {
    setEnv(ENV);
    const { getServices } = await loadFresh();

    getServices();

    expect(createAfterBackgroundTasks).toHaveBeenCalledTimes(1);
    expect(recordedDeps().backgroundTasks).toBe("THE-BACKGROUND-TASKS");
  });

  /**
   * **Why this is worth an assertion of its own.**
   *
   * Better Auth stamps a verification token's `iat` from `Date.now()` at
   * one-second resolution and adds no nonce, so two links issued for one
   * address inside the same real second are byte-identical — and an "older"
   * link that is byte-identical to the newest one is not invalidated, because
   * it *is* the newest one. What makes that unreachable is the resend floor of
   * one link a minute, and the floor is measured on the injected `Clock`.
   *
   * So "only the newest link works" holds only while the injected clock tracks
   * real time. A frozen or offset clock wired in here would let the floor pass
   * while `Date.now()` stood still, and invalidation would weaken silently —
   * no error, no failing assertion, just an old link that still works. CI
   * proved this is not hypothetical: an integration test that advanced only the
   * injected clock got the same token back twice.
   */
  it("wires the system clock, which is what the resend floor rests on", async () => {
    setEnv(ENV);
    const { getServices } = await loadFresh();

    getServices();

    expect(createSystemClock).toHaveBeenCalledTimes(1);
    expect(recordedDeps().clock).toBe(createSystemClock.mock.results[0]?.value);
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

  /**
   * The test-only email sender ([#151](https://github.com/joshstothard/3moji/issues/151)).
   *
   * **The refusal is the property that matters.** A switch that turns real
   * email off is a switch that turns account verification into a no-op if it
   * ever reaches production, so the production configuration must refuse to
   * start with it selected rather than quietly sending nothing.
   */
  describe("the test email sender", () => {
    const SWITCHES = ["TEST_EMAIL_SENDER", "NODE_ENV", "VERCEL_ENV"] as const;
    const savedSwitches = new Map<string, string | undefined>();

    /** `Reflect`, because Next.js types `NODE_ENV` as read-only. */
    function setSwitch(name: (typeof SWITCHES)[number], value?: string): void {
      if (value === undefined) Reflect.deleteProperty(process.env, name);
      else Reflect.set(process.env, name, value);
    }

    beforeEach(() => {
      for (const name of SWITCHES) savedSwitches.set(name, process.env[name]);
      setSwitch("NODE_ENV", "test");
      setSwitch("VERCEL_ENV");
      setSwitch("TEST_EMAIL_SENDER");
    });

    afterEach(() => {
      for (const name of SWITCHES) setSwitch(name, savedSwitches.get(name));
    });

    it("refuses to start in production with the test sender selected", async () => {
      setEnv(ENV);
      setSwitch("NODE_ENV", "production");
      setSwitch("TEST_EMAIL_SENDER", "recording");
      const { getServices } = await loadFresh();

      expect(() => getServices()).toThrow("TEST_EMAIL_SENDER");
      expect(createCoreServices).not.toHaveBeenCalled();
      expect(createRecordingEmailSender).not.toHaveBeenCalled();
    });

    it("refuses to start on any Vercel deployment with the test sender selected", async () => {
      setEnv(ENV);
      setSwitch("VERCEL_ENV", "preview");
      setSwitch("TEST_EMAIL_SENDER", "recording");
      const { getServices } = await loadFresh();

      expect(() => getServices()).toThrow("TEST_EMAIL_SENDER");
      expect(createCoreServices).not.toHaveBeenCalled();
    });

    it("refuses a value it does not recognise rather than guessing", async () => {
      setEnv(ENV);
      setSwitch("TEST_EMAIL_SENDER", "off");
      const { getServices } = await loadFresh();

      expect(() => getServices()).toThrow("TEST_EMAIL_SENDER");
      expect(createCoreServices).not.toHaveBeenCalled();
    });

    it("wires the recording sender, and never Resend, outside production", async () => {
      setEnv(ENV);
      setSwitch("TEST_EMAIL_SENDER", "recording");
      const { getServices } = await loadFresh();

      getServices();

      expect(createRecordingEmailSender).toHaveBeenCalledTimes(1);
      expect(createResendEmailSender).not.toHaveBeenCalled();
      expect(recordedDeps().auth.emailSender).toBe("THE-RECORDING-SENDER");
    });

    it("still requires every variable, so the environment contract does not fork", async () => {
      setEnv({ ...ENV, RESEND_API_KEY: undefined });
      setSwitch("TEST_EMAIL_SENDER", "recording");
      const { getServices } = await loadFresh();

      expect(() => getServices()).toThrow("RESEND_API_KEY");
    });

    it("sends through Resend when the switch is absent, even in production", async () => {
      setEnv(ENV);
      setSwitch("NODE_ENV", "production");
      const { getServices } = await loadFresh();

      getServices();

      expect(createResendEmailSender).toHaveBeenCalledTimes(1);
      expect(createRecordingEmailSender).not.toHaveBeenCalled();
    });
  });

  /**
   * Preview auth links (#32). `BETTER_AUTH_URL` holds the production address
   * in every Vercel environment, so a preview must build its verification and
   * reset links from its own address or they open production.
   */
  describe("the auth base URL on a Vercel preview", () => {
    const VERCEL = ["VERCEL_ENV", "VERCEL_BRANCH_URL", "VERCEL_URL"] as const;
    type VercelKey = (typeof VERCEL)[number];
    const savedVercel = new Map<VercelKey, string | undefined>();

    function setVercel(values: Partial<Record<VercelKey, string>>): void {
      for (const name of VERCEL) {
        const value = values[name];
        if (value === undefined) Reflect.deleteProperty(process.env, name);
        else process.env[name] = value;
      }
    }

    beforeEach(() => {
      for (const name of VERCEL) savedVercel.set(name, process.env[name]);
    });

    afterEach(() => {
      for (const name of VERCEL) {
        const value = savedVercel.get(name);
        if (value === undefined) Reflect.deleteProperty(process.env, name);
        else process.env[name] = value;
      }
    });

    it("is the preview's branch URL, not the production BETTER_AUTH_URL", async () => {
      setEnv({ ...ENV, BETTER_AUTH_URL: "https://3moji.example.com" });
      setVercel({
        VERCEL_ENV: "preview",
        VERCEL_BRANCH_URL: "3moji-git-feature.vercel.example.com",
        VERCEL_URL: "3moji-abc123.vercel.example.com",
      });
      const { getServices } = await loadFresh();

      getServices();

      expect(recordedDeps().auth.baseUrl).toBe(
        "https://3moji-git-feature.vercel.example.com",
      );
    });

    it("stays BETTER_AUTH_URL on production", async () => {
      setEnv({ ...ENV, BETTER_AUTH_URL: "https://3moji.example.com" });
      setVercel({
        VERCEL_ENV: "production",
        VERCEL_BRANCH_URL: "3moji-git-main.vercel.example.com",
      });
      const { getServices } = await loadFresh();

      getServices();

      expect(recordedDeps().auth.baseUrl).toBe("https://3moji.example.com");
    });

    it("refuses to start a preview with no address of its own, rather than link to production", async () => {
      setEnv(ENV);
      setVercel({ VERCEL_ENV: "preview" });
      const { getServices } = await loadFresh();

      expect(() => getServices()).toThrow("VERCEL_URL");
      expect(createCoreServices).not.toHaveBeenCalled();
    });

    it("still requires BETTER_AUTH_URL on a preview, so the environment contract does not fork", async () => {
      setEnv({ ...ENV, BETTER_AUTH_URL: undefined });
      setVercel({
        VERCEL_ENV: "preview",
        VERCEL_URL: "3moji-abc123.vercel.example.com",
      });
      const { getServices } = await loadFresh();

      expect(() => getServices()).toThrow("BETTER_AUTH_URL");
    });
  });

  it("does not build at import time, so next build needs no environment", async () => {
    setEnv({});

    // Importing must not throw with nothing configured; only calling does.
    await expect(loadFresh()).resolves.toBeDefined();
    expect(createCoreServices).not.toHaveBeenCalled();
  });
});
