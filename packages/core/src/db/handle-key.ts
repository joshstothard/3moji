import { canonicalise, type CanonicalHandle } from "../handle/canonicalise";

declare const handleKeyBrand: unique symbol;

/**
 * The canonical key of a Handle, and the only type the `handle` table's key
 * column accepts.
 *
 * ADR-0004 decision 1 says plainly that the `UNIQUE` index "only means what we
 * intend if the application canonicalises before every write". A `text` column
 * typed as `string` cannot say that; this brand can. The two constructors below
 * are the only exported way to obtain a `HandleKey`, and both run
 * `canonicalise`, so `db.insert(handle).values({ key: req.params.handle })`
 * does not compile.
 *
 * **It is a speed bump, not a wall.** `x as HandleKey` still compiles — no
 * TypeScript brand survives a deliberate assertion. What it buys is that the
 * accidental path is closed and the deliberate one is grep-able: the package's
 * lint runs `strictTypeChecked`, so an assertion is visible in review rather
 * than implicit in a `string`. The database keeps the last word regardless —
 * see the `CHECK` and the collation on the column itself.
 */
export type HandleKey = string & { readonly [handleKeyBrand]: "HandleKey" };

/**
 * The number of code points a canonical key holds. Every Emoji Set entry is a
 * single code point (ADR-0005 decision 1), so three code points is exactly
 * three emoji — which is what makes the database `CHECK` on
 * `char_length` meaningful rather than approximate.
 */
export const HANDLE_KEY_LENGTH = 3;

/**
 * The one place a `string` becomes a `HandleKey`. Private, and reached only
 * from a `canonicalise` result, so the brand's promise holds by construction.
 */
function brand(key: string): HandleKey {
  return key as HandleKey;
}

/**
 * The key an already-canonicalised Handle carries.
 *
 * Prefer this where the caller has run `canonicalise` itself and branched on
 * the failure reason — a route that 404s an unknown code point and 308s a
 * non-canonical spelling needs the whole result, not just the key.
 */
export function handleKeyOf(handle: CanonicalHandle): HandleKey {
  return brand(handle.key);
}

/**
 * Canonicalise a received segment — percent-encoded or raw emoji — into the
 * key to write, or `undefined` if it is not a Handle.
 *
 * The shorthand for a caller that has no interest in *why* a segment failed: a
 * claim form, a script, a test. Anything answering a public request should call
 * `canonicalise` directly and use {@link handleKeyOf}, because the four failure
 * reasons are four different responses.
 */
export function toHandleKey(segment: string): HandleKey | undefined {
  const result = canonicalise(segment);
  return result.ok ? handleKeyOf(result) : undefined;
}
