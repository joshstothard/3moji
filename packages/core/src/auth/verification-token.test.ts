import { verificationTokenFingerprint } from "./verification-token";

/** A shape close enough to a real Better Auth token to be a fair input. */
const TOKEN =
  "eyJhbGciOiJIUzI1NiJ9.eyJlbWFpbCI6ImNsYWltYW50QGV4YW1wbGUuY29tIn0.c2lnbmF0dXJl";

describe("verificationTokenFingerprint", () => {
  it("is deterministic, so the same link always finds its own row", () => {
    expect(verificationTokenFingerprint(TOKEN)).toBe(
      verificationTokenFingerprint(TOKEN),
    );
  });

  it("is a 64-character hex SHA-256 digest", () => {
    expect(verificationTokenFingerprint(TOKEN)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("separates two tokens that differ by a single character", () => {
    expect(verificationTokenFingerprint(`${TOKEN}x`)).not.toBe(
      verificationTokenFingerprint(TOKEN),
    );
  });

  it("does not carry the token, which is a bearer credential", () => {
    // The whole reason the column stores a digest: a row that held the token
    // would let whoever read it verify somebody else's address.
    expect(verificationTokenFingerprint(TOKEN)).not.toContain(
      TOKEN.slice(0, 12),
    );
  });

  it("refuses an empty token rather than fingerprinting every absence alike", () => {
    expect(() => verificationTokenFingerprint("")).toThrow(/requires a token/i);
  });
});
