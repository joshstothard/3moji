/**
 * The part of the domain a browser bundle may import.
 *
 * `./index.ts` is not importable from a client component. It re-exports
 * `db/client`, which reaches `pg` and `@neondatabase/serverless`, and bundling
 * those for the browser fails `next build` outright:
 *
 * ```
 * Error: Module not found: Can't resolve 'dns'   (also 'fs', 'net', 'tls', 'util/types')
 *   ./packages/core/dist/db/client.js [Client Component Browser]
 *   ./packages/core/dist/index.js [Client Component Browser]
 * ```
 *
 * The home-page Handle builder needs `spokenHandle` on the client: the spoken
 * tagline updates as each slot changes, so a round trip per keystroke is the
 * only alternative to duplicating the domain's run-collapsing rules in the UI.
 * Hence this second entry point.
 *
 * **It is a deliberate allowlist, not "index minus the database."** Every name
 * here is a pure function or a frozen data table over the Emoji Set. Adding a
 * port, an adapter, a Drizzle table or anything from `db/` or `auth/` puts the
 * build breakage above back, so `browser.test.ts` walks this module's
 * transitive imports and fails if one appears.
 */

export { EMOJI_CATEGORIES, RELEASED_CATEGORIES } from "./emoji/emoji-category";
export { isCategoryReleased } from "./emoji/emoji-category";
export type { EmojiCategory } from "./emoji/emoji-category";
export type { EmojiCandidate } from "./emoji/emoji-candidate";
export {
  findEmojiByCodepoint,
  isClaimableEmoji,
  releasedEmojiSet,
} from "./emoji/emoji-set";
export type { EmojiSetEntry } from "./emoji/emoji-set";
export {
  curatedEmojiSet,
  findCuratedEmoji,
  searchEmoji,
} from "./emoji/emoji-name";
export type { CuratedEmoji } from "./emoji/emoji-name";
export { spokenHandle } from "./emoji/spoken-handle";

export { canonicalise, HANDLE_LENGTH } from "./handle/canonicalise";
export {
  SWAP_SUGGESTION_LIMIT,
  swapSuggestions,
} from "./handle/swap-suggestions";
export type {
  SwapSuggestion,
  SwapSuggestionsInput,
} from "./handle/swap-suggestions";
export type {
  CanonicalHandle,
  CanonicalisationFailure,
  CanonicalisationFailureReason,
  CanonicalisationResult,
} from "./handle/canonicalise";
