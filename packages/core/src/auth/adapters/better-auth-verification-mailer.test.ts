import type { Auth } from "../auth-factory";
import { createBetterAuthVerificationMailer } from "./better-auth-verification-mailer";

interface SendCall {
  readonly body: { readonly email: string; readonly callbackURL?: string };
}

/**
 * Just enough of the auth instance to see what the adapter asks for.
 *
 * Built as `Auth` through a narrow shape rather than stood up for real: what is
 * under test is the one call this adapter makes, and a real instance would drag
 * in a database to prove nothing extra.
 */
const fakeAuth = (): { auth: Auth; calls: SendCall[] } => {
  const calls: SendCall[] = [];
  const api = {
    sendVerificationEmail: (call: SendCall) => {
      calls.push(call);
      return Promise.resolve({ status: true });
    },
  };
  return { auth: { api } as unknown as Auth, calls };
};

describe("createBetterAuthVerificationMailer", () => {
  it("asks Better Auth to issue and send a fresh link", async () => {
    const { auth, calls } = fakeAuth();

    await createBetterAuthVerificationMailer(auth).send("claimant@example.com");

    expect(calls).toEqual([{ body: { email: "claimant@example.com" } }]);
  });

  it("passes no callbackURL, because the link it would build is not the one we send", async () => {
    // `createAuth`'s hook rewrites the link to point at our own verification
    // page, from the token. A callbackURL here would be a value that looks as
    // though it has an effect and has none.
    const { auth, calls } = fakeAuth();

    await createBetterAuthVerificationMailer(auth).send("a@b.com");

    expect(calls[0]?.body.callbackURL).toBeUndefined();
  });

  it("decides nothing itself, so the limit above it cannot be bypassed", async () => {
    // The adapter sends whatever it is given: the rate limit lives in
    // `resendVerification`, in front of this. A mailer that second-guessed an
    // address would be a second place for the rule to live.
    const { auth, calls } = fakeAuth();
    const mailer = createBetterAuthVerificationMailer(auth);

    await mailer.send("first@example.com");
    await mailer.send("second@example.com");

    expect(calls.map((call) => call.body.email)).toEqual([
      "first@example.com",
      "second@example.com",
    ]);
  });
});
