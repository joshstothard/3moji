import { createHash } from "node:crypto";

/**
 * The stored identity of a verification token: its SHA-256, hex-encoded.
 *
 * **The token itself is never stored.** Better Auth's email-verification token
 * is a signed JWT carried in the link, which makes it a bearer credential: a
 * row holding one is a row that lets its reader verify somebody else's address.
 * A fingerprint answers the only two questions we ask of it — "is this the
 * newest link we issued?" and "whose link is this?" — and answers nothing else.
 *
 * SHA-256 without a salt or a work factor is deliberate and is *not* password
 * hashing. The input is 200-plus characters of signed, high-entropy JWT with an
 * hour's lifetime, so there is no dictionary to try; what is needed here is a
 * deterministic, collision-resistant index key, and a per-row salt would make
 * the lookup impossible.
 */
export function verificationTokenFingerprint(token: string): string {
  if (token === "") {
    throw new Error(
      "verificationTokenFingerprint requires a token. An empty string would fingerprint every missing token to the same value, which would make one account's link match another's.",
    );
  }
  return createHash("sha256").update(token, "utf8").digest("hex");
}
