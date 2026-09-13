/**
 * An email address in the one form every comparison in this system agrees on:
 * trimmed, then lowercased
 * ([#163](https://github.com/joshstothard/3moji/issues/163)).
 *
 * **Lowercased because Better Auth lowercases.** Its sign-up stores
 * `email.toLowerCase()`, and its sign-in, change-email and user lookup all
 * search by the lowercased form. An address compared any other way disagrees
 * with the library about which Account it names — which is how a Claim typed
 * as `Someone@Example.com` once failed outright while `someone@example.com`
 * reached the hold screen, a difference that revealed which addresses were
 * registered.
 *
 * **Nothing more than that.** No Unicode case folding and no provider-specific
 * rules such as dropping dots or `+tags`: normalising further than Better Auth
 * does would merge addresses the library keeps apart, which is the same
 * disagreement in the other direction.
 *
 * Called once, at the domain's Claim input ({@link ../handle/claim-handle}).
 * It is deliberately not exported from the package: a transport should hand the
 * domain the address as typed, and never be the place normalisation lives.
 */
export function normaliseEmailAddress(address: string): string {
  return address.trim().toLowerCase();
}
