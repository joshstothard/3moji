import { toHandleKey } from "../db/handle-key";
import type {
  AccountDirectory,
  AccountRecord,
  OwnedHandle,
} from "../ports/account-directory";
import { createRecordingEmailSender } from "./adapters/recording-email-sender";
import { claimCollisionEmail, notifyExistingOwner } from "./claim-collision";

const ICE = "\u{1F9CA}\u{1F9CA}\u{1F9CA}";
const KEY = toHandleKey(ICE);
if (KEY === undefined) throw new Error("the test Handle must canonicalise");

const RESET_URL = "https://3moji.me/reset-password";
const FROM = "3moji <no-reply@mail.3moji.me>";

const fakeDirectory = (
  account: AccountRecord | undefined,
  owned: OwnedHandle | undefined,
): { directory: AccountDirectory; calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    directory: {
      byEmail: (email) => {
        calls.push(`byEmail(${email})`);
        return Promise.resolve(account);
      },
      handleOf: (userId) => {
        calls.push(`handleOf(${userId})`);
        return Promise.resolve(owned);
      },
    },
  };
};

const OWNER: AccountRecord = {
  userId: "user-1",
  email: "owner@example.com",
  emailVerified: true,
};

const OWNED: OwnedHandle = {
  key: KEY,
  heldUntil: new Date("2026-09-13T12:00:00.000Z"),
  claimedAt: new Date("2026-09-12T12:00:00.000Z"),
};

describe("claimCollisionEmail", () => {
  const email = claimCollisionEmail({
    to: OWNER.email,
    handleKey: ICE,
    resetRequestUrl: RESET_URL,
    from: FROM,
  });

  it("names the Handle the address already owns", () => {
    // #15: the existing owner is told which Handle is theirs. Without it the
    // message is a generic security notice and says nothing useful.
    expect(email.text).toContain(ICE);
  });

  it("says it out loud, because that is what the product is for", () => {
    expect(email.text).toContain("three ice cubes");
  });

  it("says plainly that nothing changed", () => {
    expect(email.text).toMatch(/nothing changed/i);
  });

  it("carries a link to the reset form, not a tokenised reset link", () => {
    // Sign-up is unauthenticated: a tokenised link here would let a stranger
    // cause live reset tokens to be mailed to somebody else's inbox at will.
    expect(email.text).toContain(RESET_URL);
    expect(email.text).not.toMatch(/token=/);
    expect(email.text).not.toMatch(/reset-password\/[A-Za-z0-9._-]{8}/);
  });

  it("puts no token and no Handle in the subject line", () => {
    // Subjects are logged, previewed on lock screens and indexed far more
    // widely than bodies.
    expect(email.subject).not.toMatch(/token/i);
    expect(email.subject).not.toContain(ICE);
    expect(email.subject).toMatch(/tried to sign up/i);
  });

  it("goes to the existing owner, never to whoever submitted the form", () => {
    expect(email.to).toBe(OWNER.email);
  });
});

describe("notifyExistingOwner", () => {
  it("mails the address as stored rather than as typed", async () => {
    // A difference in case is not a different Account, and the stored spelling
    // is the one that was verified.
    const emailSender = createRecordingEmailSender();
    const { directory } = fakeDirectory(OWNER, OWNED);

    await notifyExistingOwner({
      email: "OWNER@EXAMPLE.COM",
      directory,
      emailSender,
      resetRequestUrl: RESET_URL,
      from: FROM,
    });

    expect(emailSender.sent).toHaveLength(1);
    expect(emailSender.lastSent()?.to).toBe("owner@example.com");
    expect(emailSender.lastSent()?.text).toContain(ICE);
  });

  it("sends nothing when the address has no Account", async () => {
    const emailSender = createRecordingEmailSender();
    const { directory, calls } = fakeDirectory(undefined, OWNED);

    await notifyExistingOwner({
      email: "nobody@example.com",
      directory,
      emailSender,
      resetRequestUrl: RESET_URL,
      from: FROM,
    });

    expect(emailSender.sent).toEqual([]);
    // It stops at the first read rather than asking about a Handle nobody owns.
    expect(calls).toEqual(["byEmail(nobody@example.com)"]);
  });

  it("sends nothing when the Account owns no Handle", async () => {
    // Unreachable through the product — the Account and its hold are one
    // atomic act — but "you already own a handle" mailed to somebody who owns
    // none would be worse than silence.
    const emailSender = createRecordingEmailSender();
    const { directory } = fakeDirectory(OWNER, undefined);

    await notifyExistingOwner({
      email: OWNER.email,
      directory,
      emailSender,
      resetRequestUrl: RESET_URL,
      from: FROM,
    });

    expect(emailSender.sent).toEqual([]);
  });
});
