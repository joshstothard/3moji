import type { Auth } from "../auth-factory";
import { createBetterAuthPasswordResetter } from "./better-auth-password-resetter";

/** Better Auth's thrown shape, read by property as the adapter reads it. */
const refusal = (code: string): Error =>
  Object.assign(new Error("refused"), {
    status: "BAD_REQUEST",
    body: { code, message: "refused" },
  });

function fakeAuth(options: {
  readonly requestFails?: Error;
  readonly resetFails?: Error;
}) {
  const requests: unknown[] = [];
  const resets: unknown[] = [];
  const auth = {
    api: {
      requestPasswordReset: (input: unknown) => {
        requests.push(input);
        return options.requestFails === undefined
          ? Promise.resolve({ status: true })
          : Promise.reject(options.requestFails);
      },
      resetPassword: (input: unknown) => {
        resets.push(input);
        return options.resetFails === undefined
          ? Promise.resolve({ status: true })
          : Promise.reject(options.resetFails);
      },
    },
  } as unknown as Auth;
  return { auth, requests, resets };
}

describe("createBetterAuthPasswordResetter", () => {
  describe("request", () => {
    it("asks Better Auth with the address and no redirectTo, so no tokenised callback is built", async () => {
      const { auth, requests } = fakeAuth({});

      expect(
        await createBetterAuthPasswordResetter(auth).request("a@example.com"),
      ).toBe("accepted");
      expect(requests).toEqual([{ body: { email: "a@example.com" } }]);
    });

    it("answers invalid for Better Auth's schema refusal", async () => {
      const { auth } = fakeAuth({ requestFails: refusal("VALIDATION_ERROR") });

      expect(
        await createBetterAuthPasswordResetter(auth).request("not-an-address"),
      ).toBe("invalid");
    });

    it("rethrows anything else untouched", async () => {
      const failure = new Error("database unreachable");
      const { auth } = fakeAuth({ requestFails: failure });

      await expect(
        createBetterAuthPasswordResetter(auth).request("a@example.com"),
      ).rejects.toBe(failure);
    });
  });

  describe("reset", () => {
    it("sets the password from the token", async () => {
      const { auth, resets } = fakeAuth({});

      expect(
        await createBetterAuthPasswordResetter(auth).reset("tok", "new pass"),
      ).toEqual({ state: "reset" });
      expect(resets).toEqual([
        { body: { token: "tok", newPassword: "new pass" } },
      ]);
    });

    it.each([
      ["INVALID_TOKEN", "invalid-link"],
      ["USER_NOT_FOUND", "invalid-link"],
      ["PASSWORD_TOO_SHORT", "password-too-short"],
      ["PASSWORD_TOO_LONG", "password-too-long"],
    ])("answers Better Auth's %s as %s", async (code, state) => {
      const { auth } = fakeAuth({ resetFails: refusal(code) });

      expect(
        await createBetterAuthPasswordResetter(auth).reset("tok", "x"),
      ).toEqual({ state });
    });

    it("rethrows anything else untouched", async () => {
      const failure = refusal("SOMETHING_ELSE");
      const { auth } = fakeAuth({ resetFails: failure });

      await expect(
        createBetterAuthPasswordResetter(auth).reset("tok", "long enough"),
      ).rejects.toBe(failure);
    });
  });
});
