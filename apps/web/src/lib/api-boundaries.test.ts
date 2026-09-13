/**
 * @jest-environment node
 */

/**
 * Every API boundary, held to one contract (#156).
 *
 * **The list below is the list of boundaries.** The enumeration test walks
 * `src` for `route.ts` files and `"use server"` modules, reads their exports,
 * and fails unless the set it finds equals the set in {@link CASES} — so a new
 * route handler or server action cannot be added without an entry here, and an
 * entry here is a call that must write exactly one boundary line.
 *
 * Each case runs twice, inside Next.js's real request store with a real
 * correlation id:
 *
 * - **answering**, with an email address, a password, a client IP and a token
 *   bound to every input the boundary reads (form fields, query string, path,
 *   body, forwarded headers). Exactly one boundary line, with the boundary's
 *   name and outcome, and none of those values in anything written to any
 *   console stream.
 * - **failing**, with a collaborator that throws an error whose message quotes
 *   the email address. Exactly one boundary line, `failed`, and every
 *   `logFailure` line from the same call carries the same `correlationId`.
 *
 * Only the edges are faked: `@template/core`'s use cases, the service
 * container, Better Auth's handler and the session read. `next/navigation` is
 * the **real** one, so a redirect throws exactly what it throws in production.
 */
import "../test-support/next-async-local-storage";

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { inspect } from "node:util";

import { workUnitAsyncStorage } from "next/dist/server/app-render/work-unit-async-storage.external";

const ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const EMAIL = "private.person@example.com";
const PASSWORD = "Tr0ub4dor-and-3-secret";
const IP = "198.51.100.73";
const TOKEN = "Secret-Token_9f8e7d6c5b4a";
const ICE = "\u{1F9CA}\u{1F9CA}\u{1F9CA}";
const ENCODED = "%F0%9F%A7%8A%F0%9F%A7%8A%F0%9F%A7%8A";
const PERSONAL = [EMAIL, PASSWORD, IP, TOKEN] as const;

/** The headers a real request would carry: the proxy's id and the client IP. */
function requestHeaders(): Headers {
  return new Headers({
    "x-correlation-id": ID,
    "x-vercel-forwarded-for": IP,
    "x-forwarded-for": `${IP}, 10.0.0.1`,
    "x-real-ip": IP,
  });
}

/** What `headers()` reads in production: the current request store's headers. */
function storeHeaders(): Headers {
  const store: unknown = workUnitAsyncStorage.getStore();
  return typeof store === "object" &&
    store !== null &&
    "headers" in store &&
    store.headers instanceof Headers
    ? store.headers
    : new Headers();
}
jest.mock("next/headers", () => ({
  headers: () => Promise.resolve(storeHeaders()),
}));

const navigation = jest.requireActual<{
  readonly redirect: (url: string) => never;
  readonly notFound: () => never;
}>("next/navigation");
jest.mock("next/navigation", () => ({
  redirect: (url: string) => navigation.redirect(url),
  notFound: () => navigation.notFound(),
}));

/** An error whose message quotes personal data, as a driver's can. */
function leakyError(): Error {
  return new Error(
    `Key (email)=(${EMAIL}) already exists; password "${PASSWORD}" from ${IP}`,
  );
}

const realCanonicalise = jest.requireActual<
  Pick<typeof import("@template/core"), "canonicalise">
>("../../../../packages/core/src/handle/canonicalise");

const submitClaim = jest.fn();
const finaliseClaim = jest.fn();
const resendVerification = jest.fn();
const editProfile = jest.fn();
const handleAvailability = jest.fn();
const requestPasswordReset = jest.fn();
const setNewPassword = jest.fn();
jest.mock("@template/core", () => ({
  requestPasswordReset: (input: unknown): unknown =>
    requestPasswordReset(input),
  setNewPassword: (input: unknown): unknown => setNewPassword(input),
  submitClaim: (input: unknown): unknown => submitClaim(input),
  finaliseClaim: (input: unknown): unknown => finaliseClaim(input),
  resendVerification: (input: unknown): unknown => resendVerification(input),
  editProfile: (input: unknown): unknown => editProfile(input),
  handleAvailability: (input: unknown): unknown => handleAvailability(input),
  claimableHandle: () => ({ ok: true }),
  canonicalise: (segment: string) => realCanonicalise.canonicalise(segment),
}));

const signInEmail = jest.fn();
const signInAdmit = jest.fn();
const byEmail = jest.fn();
const handleOf = jest.fn();
const getServices = jest.fn();
jest.mock("./services", () => ({
  getServices: (): unknown => getServices(),
}));

const handlerGet = jest.fn();
const handlerPost = jest.fn();
jest.mock("better-auth/next-js", () => ({
  toNextJsHandler: () => ({
    GET: (request: Request): unknown => handlerGet(request),
    POST: (request: Request): unknown => handlerPost(request),
  }),
}));

jest.mock("./profile-edit", () => ({
  readEditAuthority: () =>
    Promise.resolve({ state: "allowed", userId: "user-1" }),
}));

/**
 * `next/og` renders a PNG with WebAssembly, which is the image routes' edge
 * (#161). Faked as a Response that can be made to throw, the way a render
 * that fails would.
 */
const ogImage = { fails: false };
jest.mock("next/og", () => ({
  ImageResponse: class extends Response {
    constructor(
      _element: unknown,
      options: { headers?: Readonly<Record<string, string>> },
    ) {
      if (ogImage.fails) throw leakyError();
      super(new Uint8Array([0x89]), {
        status: 200,
        headers: { "content-type": "image/png", ...options.headers },
      });
    }
  },
}));

import * as authRoute from "../app/api/auth/[...all]/route";
import * as verifyRoute from "../app/claim/verify/route";
import * as genericImageRoute from "../app/og-image/route";
import * as handleImageRoute from "../app/[handle]/og-image/route";
import * as availabilityAction from "../components/availability-action";
import * as claimAction from "../components/claim-action";
import * as passwordResetAction from "../components/password-reset-action";
import * as profileEditAction from "../components/profile-edit-action";
import * as resendAction from "../components/resend-action";
import * as signInAction from "../components/sign-in-action";
import {
  BOUNDARIES,
  BOUNDARY_EVENT,
  BOUNDARY_OUTCOMES,
  type Boundary,
  type BoundaryOutcome,
} from "./boundary-log";

/** Every collaborator answering the way a healthy deployment answers. */
function healthy(): void {
  ogImage.fails = false;
  getServices.mockImplementation(() => ({
    auth: { api: { signInEmail } },
    accounts: { byEmail, handleOf },
    claims: {},
    clock: { now: () => new Date(0) },
    dispatches: {},
    claimFinaliser: {},
    verificationMailer: {},
    handles: {},
    profileEdits: {},
    resetRequestUrl: "http://localhost:3000/reset-password",
    emailFrom: "3moji <no-reply@mail.3moji.me>",
    emailSender: {},
    claimRateLimiter: {},
    resendClientRateLimiter: {},
    signInClientRateLimiter: { admit: signInAdmit },
    resetRequestClientRateLimiter: {},
    passwordResetter: {},
  }));
  submitClaim.mockResolvedValue({
    state: "pending",
    handle: { key: ICE, encoded: ENCODED },
  });
  finaliseClaim.mockResolvedValue({
    state: "claimed",
    key: ICE,
    headers: new Headers({ "set-cookie": "session=abc; Path=/; HttpOnly" }),
  });
  resendVerification.mockResolvedValue({ state: "sent" });
  editProfile.mockResolvedValue({ state: "saved" });
  handleAvailability.mockResolvedValue({ state: "available" });
  requestPasswordReset.mockResolvedValue({ state: "sent" });
  setNewPassword.mockResolvedValue({ state: "reset" });
  signInEmail.mockResolvedValue({});
  signInAdmit.mockResolvedValue({ state: "admitted" });
  byEmail.mockResolvedValue({ userId: "user-1", email: EMAIL });
  handleOf.mockResolvedValue({ key: ICE });
  handlerGet.mockResolvedValue(
    new Response(null, { status: 302, headers: { location: "/" } }),
  );
  handlerPost.mockResolvedValue(new Response("{}", { status: 401 }));
}

/** A claim, sign-in or resend form carrying personal data in every field. */
function personalForm(): FormData {
  const data = new FormData();
  data.set("handle", ENCODED);
  data.set("email", EMAIL);
  data.set("password", PASSWORD);
  data.set("reason", "pending");
  data.set("displayName", EMAIL);
  data.set("bio", `${PASSWORD} ${IP}`);
  data.set("link-0-title", TOKEN);
  data.set("link-0-url", `https://example.com/?email=${EMAIL}`);
  data.set("token", TOKEN);
  return data;
}

const query = `token=${TOKEN}&email=${encodeURIComponent(EMAIL)}&password=${PASSWORD}`;

function authGetRequest(): Request {
  return new Request(
    `http://localhost:3000/api/auth/reset-password/${TOKEN}?callbackURL=%2F&${query}`,
    { headers: requestHeaders() },
  );
}

function authPostRequest(): Request {
  return new Request(`http://localhost:3000/api/auth/sign-in/email?${query}`, {
    method: "POST",
    headers: requestHeaders(),
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
}

function verifyRequest(): Request {
  return new Request(`http://localhost:3000/claim/verify?${query}`, {
    headers: requestHeaders(),
  });
}

interface BoundaryCase {
  /** The module, relative to `apps/web/src`. */
  readonly file: string;
  /** The exported function that is the boundary. */
  readonly exportName: string;
  readonly boundary: Boundary;
  /** Call it with personal data bound to every input. */
  readonly answer: () => Promise<unknown>;
  /** The outcome that call is logged with. */
  readonly answered: BoundaryOutcome;
  /** Break a collaborator, then call it the same way. */
  readonly fail: () => Promise<unknown>;
  /** Whether the boundary's own catch writes a `logFailure` line. */
  readonly logsFailure: boolean;
}

const CASES: readonly BoundaryCase[] = [
  {
    file: "app/api/auth/[...all]/route.ts",
    exportName: "GET",
    boundary: "auth.get",
    answer: () => authRoute.GET(authGetRequest()),
    answered: "redirected",
    fail: () => {
      handlerGet.mockRejectedValue(leakyError());
      return authRoute.GET(authGetRequest());
    },
    logsFailure: false,
  },
  {
    file: "app/api/auth/[...all]/route.ts",
    exportName: "POST",
    boundary: "auth.post",
    answer: () => authRoute.POST(authPostRequest()),
    answered: "rejected",
    fail: () => {
      getServices.mockImplementation(() => {
        throw leakyError();
      });
      return authRoute.POST(authPostRequest());
    },
    logsFailure: false,
  },
  {
    file: "app/claim/verify/route.ts",
    exportName: "GET",
    boundary: "claim.verify",
    answer: () => verifyRoute.GET(verifyRequest()),
    answered: "redirected",
    fail: () => {
      finaliseClaim.mockRejectedValue(leakyError());
      return verifyRoute.GET(verifyRequest());
    },
    logsFailure: false,
  },
  {
    file: "app/og-image/route.ts",
    exportName: "GET",
    boundary: "og-image.generic",
    answer: () => genericImageRoute.GET(),
    answered: "ok",
    fail: () => {
      ogImage.fails = true;
      return genericImageRoute.GET();
    },
    logsFailure: false,
  },
  {
    // Answered for an unclaimed Handle, so the generic image is drawn. The
    // line is `ok` whatever the state — the route answered with an image — so
    // the log cannot become a record of which Handles are held either.
    file: "app/[handle]/og-image/route.ts",
    exportName: "GET",
    boundary: "og-image.handle",
    answer: () =>
      handleImageRoute.GET(verifyRequest(), {
        params: Promise.resolve({ handle: ENCODED }),
      }),
    answered: "ok",
    fail: () => {
      ogImage.fails = true;
      return handleImageRoute.GET(verifyRequest(), {
        params: Promise.resolve({ handle: ENCODED }),
      });
    },
    logsFailure: false,
  },
  {
    file: "components/availability-action.ts",
    exportName: "checkAvailability",
    boundary: "availability.check",
    answer: () => availabilityAction.checkAvailability(ENCODED),
    answered: "ok",
    fail: () => {
      getServices.mockImplementation(() => {
        throw leakyError();
      });
      return availabilityAction.checkAvailability(ENCODED);
    },
    logsFailure: true,
  },
  {
    file: "components/claim-action.ts",
    exportName: "submitClaimAction",
    boundary: "claim.submit",
    answer: () => claimAction.submitClaimAction(personalForm()),
    answered: "redirected",
    fail: () => {
      submitClaim.mockRejectedValue(leakyError());
      return claimAction.submitClaimAction(personalForm());
    },
    logsFailure: true,
  },
  {
    file: "components/claim-action.ts",
    exportName: "claimFormAction",
    boundary: "claim.form",
    answer: () =>
      claimAction.claimFormAction({ state: "idle" }, personalForm()),
    answered: "redirected",
    fail: () => {
      submitClaim.mockRejectedValue(leakyError());
      return claimAction.claimFormAction({ state: "idle" }, personalForm());
    },
    logsFailure: true,
  },
  {
    file: "components/sign-in-action.ts",
    exportName: "signInAction",
    boundary: "sign-in.submit",
    answer: () => signInAction.signInAction(personalForm()),
    answered: "redirected",
    fail: () => {
      signInEmail.mockRejectedValue({
        status: "FORBIDDEN",
        body: { code: "EMAIL_NOT_VERIFIED" },
      });
      byEmail.mockRejectedValue(leakyError());
      return signInAction.signInAction(personalForm());
    },
    logsFailure: true,
  },
  {
    file: "components/sign-in-action.ts",
    exportName: "signInFormAction",
    boundary: "sign-in.form",
    answer: () => signInAction.signInFormAction(personalForm()),
    answered: "redirected",
    fail: () => {
      signInEmail.mockRejectedValue({
        status: "FORBIDDEN",
        body: { code: "EMAIL_NOT_VERIFIED" },
      });
      byEmail.mockRejectedValue(leakyError());
      return signInAction.signInFormAction(personalForm());
    },
    logsFailure: true,
  },
  {
    file: "components/profile-edit-action.ts",
    exportName: "saveProfileAction",
    boundary: "profile.save",
    answer: () =>
      profileEditAction.saveProfileAction({ state: "idle" }, personalForm()),
    answered: "redirected",
    fail: () => {
      editProfile.mockRejectedValue(leakyError());
      return profileEditAction.saveProfileAction(
        { state: "idle" },
        personalForm(),
      );
    },
    logsFailure: true,
  },
  {
    file: "components/resend-action.ts",
    exportName: "requestNewVerificationLink",
    boundary: "verification.resend",
    answer: () => resendAction.requestNewVerificationLink(personalForm()),
    answered: "redirected",
    fail: () => {
      resendVerification.mockRejectedValue(leakyError());
      return resendAction.requestNewVerificationLink(personalForm());
    },
    logsFailure: true,
  },
  {
    file: "components/password-reset-action.ts",
    exportName: "requestPasswordResetFormAction",
    boundary: "password-reset.request",
    answer: () =>
      passwordResetAction.requestPasswordResetFormAction(personalForm()),
    answered: "redirected",
    fail: () => {
      requestPasswordReset.mockRejectedValue(leakyError());
      return passwordResetAction.requestPasswordResetFormAction(personalForm());
    },
    logsFailure: true,
  },
  {
    file: "components/password-reset-action.ts",
    exportName: "setNewPasswordFormAction",
    boundary: "password-reset.set",
    answer: () => passwordResetAction.setNewPasswordFormAction(personalForm()),
    answered: "redirected",
    fail: () => {
      setNewPassword.mockRejectedValue(leakyError());
      return passwordResetAction.setNewPasswordFormAction(personalForm());
    },
    logsFailure: true,
  },
];

interface Written {
  readonly stream: "log" | "info" | "warn" | "error" | "debug";
  readonly text: string;
}

const written: Written[] = [];

beforeEach(() => {
  jest.clearAllMocks();
  written.length = 0;
  healthy();
  for (const stream of ["log", "info", "warn", "error", "debug"] as const) {
    jest.spyOn(console, stream).mockImplementation((...args: unknown[]) => {
      written.push({
        stream,
        text: args
          .map((arg) => (typeof arg === "string" ? arg : inspect(arg)))
          .join(" "),
      });
    });
  }
});

afterEach(() => {
  jest.restoreAllMocks();
});

/**
 * Run `call` inside Next.js's real request store, as the server would, and
 * settle it: a redirect or a rethrown failure is the boundary's answer, not
 * the test's error. `Reflect.apply` because the store's declared type is a
 * full `RequestStore`, which this test deliberately does not build.
 */
async function insideRequest(call: () => Promise<unknown>): Promise<void> {
  let settled: Promise<void> = Promise.resolve();
  Reflect.apply(
    workUnitAsyncStorage.run.bind(workUnitAsyncStorage),
    undefined,
    [
      { type: "request", headers: requestHeaders() },
      () => {
        settled = call().then(
          () => undefined,
          () => undefined,
        );
      },
    ],
  );
  await settled;
}

function parsed(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null
      ? Object.fromEntries(Object.entries(value))
      : undefined;
  } catch {
    return undefined;
  }
}

/** Every boundary line written, in order. */
function boundaryLines(): Record<string, unknown>[] {
  return written
    .map((entry) => parsed(entry.text))
    .filter(
      (line): line is Record<string, unknown> => line?.event === BOUNDARY_EVENT,
    );
}

/** Every `logFailure` line written, in order. */
function failureLines(): Record<string, unknown>[] {
  return written
    .filter((entry) => entry.stream === "error")
    .map((entry) => parsed(entry.text))
    .filter(
      (line): line is Record<string, unknown> =>
        line !== undefined && line.event !== BOUNDARY_EVENT,
    );
}

function expectOneWellFormedLine(
  boundaryCase: BoundaryCase,
  outcome: BoundaryOutcome,
): Record<string, unknown> {
  const lines = boundaryLines();
  expect(lines).toHaveLength(1);
  const [line] = lines;
  if (line === undefined) throw new Error("no boundary line");

  const allowed = [
    "boundary",
    "correlationId",
    "durationMs",
    "event",
    "outcome",
  ];
  if (boundaryCase.boundary.startsWith("auth.")) allowed.push("endpoint");
  for (const key of Object.keys(line)) {
    expect(allowed).toContain(key);
  }
  expect(line).toMatchObject({
    event: BOUNDARY_EVENT,
    boundary: boundaryCase.boundary,
    outcome,
    correlationId: ID,
  });
  expect(BOUNDARY_OUTCOMES).toContain(line.outcome);
  expect(typeof line.durationMs).toBe("number");
  return line;
}

function expectNoPersonalData(): void {
  const everything = written.map((entry) => entry.text).join("\n");
  for (const value of PERSONAL) {
    expect(everything).not.toContain(value);
  }
  // An encoded form of the address is the same leak.
  expect(everything).not.toContain(encodeURIComponent(EMAIL));
}

describe.each(CASES)("$file $exportName", (boundaryCase) => {
  it("writes exactly one boundary line when it answers, and no personal data", async () => {
    await insideRequest(boundaryCase.answer);

    expectOneWellFormedLine(boundaryCase, boundaryCase.answered);
    expectNoPersonalData();
  });

  it("writes exactly one failed line when a collaborator throws, sharing its correlation id with any logFailure line", async () => {
    await insideRequest(boundaryCase.fail);

    expectOneWellFormedLine(boundaryCase, "failed");
    const failures = failureLines();
    if (boundaryCase.logsFailure) {
      expect(failures.length).toBeGreaterThan(0);
    }
    for (const failure of failures) {
      expect(failure.correlationId).toBe(ID);
    }
    expectNoPersonalData();
  });
});

describe("the resend action's per-client-address limit (#158)", () => {
  it("logs a refusal as rate-limited, handing the limiter the client address but writing it nowhere", async () => {
    // What `resendVerification` answers when the per-client limit refuses:
    // `too-many` with that window's "when", the notice the hold screen renders.
    resendVerification.mockResolvedValue({
      state: "too-many",
      retryAfterMs: 1_200_000,
    });

    await insideRequest(() =>
      resendAction.requestNewVerificationLink(personalForm()),
    );

    expect(resendVerification).toHaveBeenCalledWith(
      expect.objectContaining({ clientAddress: IP }),
    );
    expect(boundaryLines()).toEqual([
      expect.objectContaining({
        boundary: "verification.resend",
        outcome: "rate-limited",
      }),
    ]);
    expectNoPersonalData();
  });
});

describe("the sign-in form's per-client-address limit (#180)", () => {
  it.each([
    ["sign-in.submit", () => signInAction.signInAction(personalForm())],
    ["sign-in.form", () => signInAction.signInFormAction(personalForm())],
  ] as const)(
    "logs a refusal at %s as rate-limited, handing the limiter the client address but writing it nowhere",
    async (boundary, call) => {
      signInAdmit.mockResolvedValue({ state: "rate-limited" });

      await insideRequest(call);

      expect(signInAdmit.mock.calls).toEqual([[IP]]);
      expect(signInEmail).not.toHaveBeenCalled();
      expect(boundaryLines()).toEqual([
        expect.objectContaining({ boundary, outcome: "rate-limited" }),
      ]);
      expectNoPersonalData();
    },
  );

  it.each([
    ["sign-in.submit", () => signInAction.signInAction(personalForm())],
    ["sign-in.form", () => signInAction.signInFormAction(personalForm())],
  ] as const)(
    "logs a limiter that cannot count at %s as failed, through logFailure, with no personal data",
    async (boundary, call) => {
      signInAdmit.mockRejectedValue(leakyError());

      await insideRequest(call);

      expect(signInEmail).not.toHaveBeenCalled();
      expect(boundaryLines()).toEqual([
        expect.objectContaining({ boundary, outcome: "failed" }),
      ]);
      expect(failureLines()).toEqual([
        expect.objectContaining({
          event: "sign_in_rate_limit_failed",
          correlationId: ID,
        }),
      ]);
      expectNoPersonalData();
    },
  );
});

describe("the password reset form actions (#192)", () => {
  it("hands the reset request limiter the client address, writing it nowhere, and logs a refusal as rate-limited", async () => {
    requestPasswordReset.mockResolvedValue({ state: "rate-limited" });

    await insideRequest(() =>
      passwordResetAction.requestPasswordResetFormAction(personalForm()),
    );

    expect(requestPasswordReset).toHaveBeenCalledWith(
      expect.objectContaining({ clientAddress: IP, email: EMAIL }),
    );
    expect(boundaryLines()).toEqual([
      expect.objectContaining({
        boundary: "password-reset.request",
        outcome: "rate-limited",
      }),
    ]);
    expectNoPersonalData();
  });

  it.each([
    [{ state: "invalid-link" }, "rejected"],
    [{ state: "password-too-short" }, "rejected"],
    [{ state: "password-too-long" }, "rejected"],
  ] as const)(
    "logs a set-new-password answer of %j as %s, with no token or password",
    async (answer, outcome) => {
      setNewPassword.mockResolvedValue(answer);

      await insideRequest(() =>
        passwordResetAction.setNewPasswordFormAction(personalForm()),
      );

      expect(setNewPassword).toHaveBeenCalledWith(
        expect.objectContaining({ token: TOKEN, newPassword: PASSWORD }),
      );
      expect(boundaryLines()).toEqual([
        expect.objectContaining({ boundary: "password-reset.set", outcome }),
      ]);
      expectNoPersonalData();
    },
  );
});

describe("the auth route", () => {
  it("names a reset-password link's endpoint without its token", async () => {
    await insideRequest(() => authRoute.GET(authGetRequest()));

    expect(boundaryLines()[0]?.endpoint).toBe("reset-password/:token");
  });

  it("names the sign-in endpoint and nothing from its body", async () => {
    await insideRequest(() => authRoute.POST(authPostRequest()));

    expect(boundaryLines()[0]?.endpoint).toBe("sign-in/email");
  });
});

describe("no boundary can be added silently", () => {
  const SRC = join(__dirname, "..");

  function sourceFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return /\.(ts|tsx|js|jsx|mjs)$/.test(entry.name) &&
        !/\.test\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)
        ? [path]
        : [];
    });
  }

  /** Every runtime export a module declares; types and interfaces are not boundaries. */
  function exportsOf(source: string): string[] {
    const names: string[] = [];
    const declared =
      /^export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm;
    for (const match of source.matchAll(declared)) {
      if (match[1] !== undefined) names.push(match[1]);
    }
    if (/^export\s+default\b/m.test(source)) names.push("default");
    for (const match of source.matchAll(/^export\s*\{([^}]*)\}/gm)) {
      for (const part of (match[1] ?? "").split(",")) {
        const name = part
          .trim()
          .split(/\s+as\s+/)
          .pop();
        if (name !== undefined && name !== "" && !name.startsWith("type ")) {
          names.push(name);
        }
      }
    }
    return names;
  }

  const DIRECTIVE = /^\s*["']use server["'];?\s*$/m;

  const discovered = sourceFiles(SRC).flatMap((path) => {
    const file = relative(SRC, path).split(sep).join("/");
    const source = readFileSync(path, "utf8");
    // Every extension Next.js accepts for a route handler, so a `route.js`
    // cannot slip past the list.
    const isRoute = /^app\/(.+\/)?route\.(ts|tsx|js|jsx|mjs)$/.test(file);
    const isServerModule = DIRECTIVE.test(source);
    return isRoute || isServerModule
      ? exportsOf(source).map((name) => `${file}#${name}`)
      : [];
  });

  it("finds the boundaries it is meant to find", () => {
    // A guard that finds nothing passes vacuously.
    expect(discovered.length).toBeGreaterThanOrEqual(CASES.length);
  });

  it("has a case for every route handler and server action export, and no stale ones", () => {
    const listed = CASES.map((entry) => `${entry.file}#${entry.exportName}`);

    expect([...discovered].sort()).toEqual([...listed].sort());
  });

  it('puts every "use server" directive at the top of its module, where it can be enumerated', () => {
    for (const path of sourceFiles(SRC)) {
      const source = readFileSync(path, "utf8");
      if (!DIRECTIVE.test(source)) continue;
      expect(source.trimStart()).toMatch(/^["']use server["'];/);
    }
  });

  it("gives every boundary name exactly one case", () => {
    expect(CASES.map((entry) => entry.boundary).sort()).toEqual(
      [...BOUNDARIES].sort(),
    );
  });
});
