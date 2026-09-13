/**
 * The reordering rule: **take one Link out and put it back somewhere else.**
 *
 * `data-model.md` § Profile says "Links are shown in an order the owner sets",
 * and `ports/profile-store.ts` says the array's order *is* `position`. So
 * reordering is a rearrangement of the list, and nothing more — no positions to
 * renumber, no gaps to close by hand, and nothing here that needs to know how
 * many Links a Profile may have. {@link ./validate-profile.LINK_LIMIT} is
 * deliberately not imported: a move cannot change how long the list is, so a
 * limit referenced here would be a second opinion on a question this function
 * never asks.
 *
 * **It lives in `packages/core` because it is a rule, not an interaction.**
 * Dragging and the move-up/move-down buttons are two ways of naming the same
 * pair of indices; both hand them here, so the mouse path and the keyboard path
 * cannot drift into producing different orders — the failure mode that makes a
 * keyboard alternative a token gesture rather than an equal one.
 *
 * **Nothing is clamped.** A move whose indices are not both real positions in
 * the list is refused whole, and the list comes back as it was. Clamping would
 * turn "move the first Link up" — the ordinary thing that happens when somebody
 * presses the button at the top — into a silent move to somewhere, and the
 * caller could not tell the two apart to announce them differently.
 *
 * **A refused or empty move returns the very same array**, by reference. That
 * is what lets a React caller pass the result straight to a state setter and
 * have the no-op cost no render; it is a property {@link moveLink}'s tests pin
 * with `toBe`, not an implementation detail to rely on loosely.
 *
 * Generic over the element, because the browser's row carries an id the domain
 * has never heard of and the domain's draft does not. What moves is whatever it
 * was handed.
 *
 * @param links The list as it stands.
 * @param from Where the Link is now.
 * @param to Where it should end up, **counted in the finished list** — so
 *   `moveLink(list, 0, 3)` on four Links puts the first one last.
 * @returns The rearranged list, or `links` itself if the move changes nothing.
 */
export function moveLink<T>(
  links: readonly T[],
  from: number,
  to: number,
): readonly T[] {
  if (!isPositionIn(links, from) || !isPositionIn(links, to)) return links;
  if (from === to) return links;

  // The moving Link is carried as a one-entry **slice** rather than read out by
  // index. `links[from]` is `T | undefined` under `noUncheckedIndexedAccess`,
  // and this package forbids both the non-null assertion and the cast that
  // would stand in for it — while a `=== undefined` guard would be a lie for a
  // list whose entries may legitimately be `undefined`. A slice is neither.
  const moving = links.slice(from, from + 1);
  const rearranged = links.filter((_, index) => index !== from);
  rearranged.splice(to, 0, ...moving);

  return rearranged;
}

/**
 * Whether `index` names a place in the list.
 *
 * Integers only: a fractional index would `splice` at a rounded-down position
 * while reading as a different number to whoever passed it.
 */
function isPositionIn(links: readonly unknown[], index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < links.length;
}
