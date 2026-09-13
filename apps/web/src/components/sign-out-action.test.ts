/**
 * @jest-environment node
 */

/**
 * Sign-out ([#194](https://github.com/joshstothard/3moji/issues/194)), as a
 * transport adapter.
 *
 * Written from the issue's criteria and notes: Better Auth's `signOut` is
 * called server-side **with the request's own headers**, the person lands on
 * `/`, and a failure is logged through `logFailure` alone. That the session
 * row is really gone, and the old cookie really reads as signed out, is proved
 * against Postgres in `packages/core/src/auth/auth.integration.test.ts` and
 * end to end in `e2e/sign-out.spec.ts`; this suite proves the wiring.
 *
 * `next/navigation`'s `redirect` is faked as a recorder so the order of the
 * two calls can be read back.
 */
const signOut = jest.fn();
const getServices = jest.fn((): unknown => ({ auth: { api: { signOut } } }));
jest.mock("../lib/services", () => ({
  getServices: (): unknown => getServices(),
}));

const SESSION_COOKIE = "better-auth.session_token=fake-token.fake-signature";
const requestHeaders = new Headers({ cookie: SESSION_COOKIE });
jest.mock("next/headers", () => ({
  headers: () => Promise.resolve(requestHeaders),
}));

const redirect = jest.fn((_url: string): undefined => undefined);
jest.mock("next/navigation", () => ({
  redirect: (url: string): undefined => {
    redirect(url);
  },
}));

import { signOutFormAction } from "./sign-out-action";

/** A message that quotes personal data, as a driver's error can. */
const LEAKY_MESSAGE = "Key (email)=(private.person@example.com) already exists";

let errors: string[] = [];

beforeEach(() => {
  jest.clearAllMocks();
  getServices.mockImplementation(() => ({ auth: { api: { signOut } } }));
  signOut.mockResolvedValue({ success: true });
  errors = [];
  jest.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });
  jest.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("signOutFormAction", () => {
  it("signs the session out through Better Auth, with the request's own headers", async () => {
    await signOutFormAction();

    expect(signOut.mock.calls).toEqual([[{ headers: requestHeaders }]]);
    const [[call]] = signOut.mock.calls as [[{ headers: Headers }]];
    expect(call.headers.get("cookie")).toBe(SESSION_COOKIE);
  });

  it("lands on / once the session is signed out, and not before", async () => {
    await signOutFormAction();

    expect(redirect.mock.calls).toEqual([["/"]]);
    expect(signOut.mock.invocationCallOrder[0]).toBeLessThan(
      redirect.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("reads nothing from the form, so no field can choose where it lands", async () => {
    const hostile = new FormData();
    hostile.set("callbackURL", "https://attacker.example/");
    hostile.set("redirectTo", "//attacker.example/");

    // A form action is handed the form's data; this one must ignore it.
    await Reflect.apply(signOutFormAction, undefined, [hostile]);

    expect(signOut.mock.calls).toEqual([[{ headers: requestHeaders }]]);
    expect(redirect.mock.calls).toEqual([["/"]]);
  });

  it.each([
    [
      "Better Auth's sign-out throws",
      () => {
        signOut.mockRejectedValue(new Error(LEAKY_MESSAGE));
      },
    ],
    [
      "the services cannot be built",
      () => {
        getServices.mockImplementation(() => {
          throw new Error(LEAKY_MESSAGE);
        });
      },
    ],
  ])(
    "logs through logFailure alone when %s, without the error's message, and still lands on /",
    async (_name, breakIt) => {
      breakIt();

      await signOutFormAction();

      const lines = errors.map((text): unknown => JSON.parse(text));
      expect(lines).toEqual([
        expect.objectContaining({ event: "sign_out_failed" }),
      ]);
      expect(errors.join("\n")).not.toContain("private.person@example.com");
      expect(redirect.mock.calls).toEqual([["/"]]);
    },
  );
});
