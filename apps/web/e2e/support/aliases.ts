import {
  aliasTermSlugs,
  resolveAlias,
  type AliasCandidate,
} from "@template/core";

/**
 * Word aliases whose database state one spec depends on and another must
 * therefore never change.
 *
 * Every spec shares one database for the whole job, across both Playwright
 * projects and every retry, so a Handle one spec claims is visible to all the
 * others. `accessibility.spec.ts` claims Handles under a randomly chosen alias
 * to render a listing ([#153](https://github.com/joshstothard/3moji/issues/153));
 * when that random pick landed on the alias below, the Handle route's
 * "names several, lists nothing" check saw a listing instead and failed on
 * every attempt ([#177](https://github.com/joshstothard/3moji/issues/177)).
 */

/**
 * An alias naming more than one Handle, **none of which any spec claims**.
 * `apple` is a synonym of both 🍎 and 🍏, so this names eight Handles.
 */
export const UNCLAIMED_SEVERAL_ALIAS = "apple.apple.apple";

/** An alias whose one repeated term names several emoji, with its Handles. */
export interface ListingAlias {
  readonly alias: string;
  readonly candidates: readonly AliasCandidate[];
}

/**
 * Every alias the alias listing check may seed under: one term repeated three
 * times, naming more than one Handle, taken from the domain's own vocabulary
 * rather than hard-coded, so a change to the curated names cannot leave the
 * check pointing at a word that no longer exists.
 *
 * **An alias is excluded by the Handles it names, not by its text.** Excluding
 * only `UNCLAIMED_SEVERAL_ALIAS` itself (#177) left `fruit.fruit.fruit`, which
 * names the same eight Handles, free to be seeded; when the random pick landed
 * there, `handle-url.spec.ts` failed on every retry
 * ([#187](https://github.com/joshstothard/3moji/issues/187)). Resolving through
 * `resolveAlias` means a synonym added later cannot reopen the collision.
 */
export function listingAliases(): readonly ListingAlias[] {
  const reserved = unclaimedSeveralHandleKeys();
  return aliasTermSlugs().flatMap((term) => {
    const alias = [term, term, term].join(".");
    const resolution = resolveAlias(alias);
    if (!resolution.ok || resolution.candidates.length < 2) return [];
    const { candidates } = resolution;
    return candidates.some((candidate) => reserved.has(candidate.key))
      ? []
      : [{ alias, candidates }];
  });
}

/**
 * The keys of the Handles `UNCLAIMED_SEVERAL_ALIAS` names, resolved by the
 * domain rather than listed here.
 *
 * @throws if the alias no longer names several Handles — an empty set would
 * silently turn every guard built on it off.
 */
export function unclaimedSeveralHandleKeys(): ReadonlySet<string> {
  const resolution = resolveAlias(UNCLAIMED_SEVERAL_ALIAS);
  if (!resolution.ok || resolution.candidates.length < 2) {
    throw new Error(
      `${UNCLAIMED_SEVERAL_ALIAS} no longer names several Handles; pick another alias for handle-url.spec.ts.`,
    );
  }
  return new Set(resolution.candidates.map((candidate) => candidate.key));
}
