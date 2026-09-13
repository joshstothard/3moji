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
