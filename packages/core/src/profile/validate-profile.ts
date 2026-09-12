/**
 * The Profile's field limits, enforced in the domain.
 *
 * `docs/architecture/data-model.md` § Profile fixes them — 30, 160, 10, 40, and
 * `http` or `https` only — and says plainly they are enforced **in
 * `packages/core`, not only in the form**. A limit that lives in a React
 * component is a suggestion: the form is one caller, and a server action, a
 * future API and an import path are others.
 *
 * Pure and framework-free: no database, no I/O, no clock. It answers about a
 * value it is handed.
 */

/** One titled URL on a Profile, as submitted. */
export interface ProfileLinkDraft {
  readonly title: string;
  readonly url: string;
}

/**
 * A Profile's editable fields, as submitted. A *draft* because it has not been
 * validated yet — {@link validateProfile} is what says whether it may be
 * written. Links carry no order field: the array order **is** the order the
 * owner set, which is what the Profile shows.
 */
export interface ProfileDraft {
  readonly displayName: string;
  readonly bio: string;
  readonly links: readonly ProfileLinkDraft[];
}

/**
 * One thing wrong with a draft, naming **which field and which rule**.
 *
 * A form has to tell the owner what to fix, so a boolean is not enough and a
 * thrown error is the wrong shape — a rejection here is an ordinary answer to
 * an ordinary edit, the same argument
 * {@link ../handle/canonicalise.canonicalise} makes. The variants are
 * deliberately different answers: "this scheme is not allowed" and "this is not
 * a URL at all" are different things to say to somebody typing a link.
 *
 * `index` is the Link's position in {@link ProfileDraft.links}, so a form can
 * attach the message to the right row.
 */
export type ProfileViolation =
  | {
      readonly field: "displayName";
      readonly rule: "too-long";
      readonly limit: number;
      readonly length: number;
    }
  | {
      readonly field: "bio";
      readonly rule: "too-long";
      readonly limit: number;
      readonly length: number;
    }
  | {
      readonly field: "links";
      readonly rule: "too-many";
      readonly limit: number;
      readonly count: number;
    }
  | {
      readonly field: "link.title";
      readonly index: number;
      readonly rule: "too-long";
      readonly limit: number;
      readonly length: number;
    }
  | {
      readonly field: "link.url";
      readonly index: number;
      readonly rule: "unsupported-scheme";
      /** The parsed scheme, lower-cased and trailing-colon'd: `javascript:`. */
      readonly scheme: string;
    }
  | {
      readonly field: "link.url";
      readonly index: number;
      readonly rule: "malformed-url";
    };

/**
 * Which field a violation is about. Derived from {@link ProfileViolation}
 * rather than spelled out, so a new variant cannot be added without appearing
 * here — the same trick {@link
 * ../handle/canonicalise.CanonicalisationFailureReason} uses.
 */
export type ProfileViolationField = ProfileViolation["field"];

/** Which rule a violation broke. Derived, for the reason above. */
export type ProfileViolationRule = ProfileViolation["rule"];

/**
 * The verdict on a draft.
 *
 * The rejection carries **every** violation, not the first. That is a
 * deliberate departure from `canonicalise`'s leftmost-offender rule: there the
 * caller renders one HTTP response, here the caller renders a form, and a form
 * that reveals one problem per submission is a form nobody finishes. The
 * property leftmost-offender exists to give is kept by other means — the
 * violations are emitted in a **fixed order** (display name, bio, link count,
 * then per-Link ascending with title before URL), so the list is a function of
 * the input alone.
 *
 * A success carries nothing but `ok`: there is nothing to derive here, and the
 * caller already holds the draft it asked about.
 */
export type ProfileValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly violations: readonly ProfileViolation[] };

/** Display name limit, `data-model.md` § Profile. In **code points**. */
export const DISPLAY_NAME_MAX_LENGTH = 30;

/** Bio limit, `data-model.md` § Profile. In **code points**. */
export const BIO_MAX_LENGTH = 160;

/** The most Links one Profile may carry, `data-model.md` § Profile. */
export const LINK_LIMIT = 10;

/** Link title limit, `data-model.md` § Profile. In **code points**. */
export const LINK_TITLE_MAX_LENGTH = 40;

/**
 * The only schemes a Link may use, as `URL.protocol` spells them.
 *
 * **This is a security control, not a format check.** A Profile renders
 * owner-supplied URLs to visitors, so `javascript:` and `data:` are the cases
 * that matter — an owner who types a bare `example.com` has made a typo, an
 * owner who saves `javascript:` has built a stored XSS vector aimed at everyone
 * who opens their page. It is an **allowlist** rather than a list of the
 * dangerous ones, so a scheme nobody thought of (`vbscript:`, `blob:`, an app's
 * custom scheme) is refused by default.
 */
export const ALLOWED_LINK_SCHEMES: readonly string[] = ["http:", "https:"];

/**
 * Count **code points**, not UTF-16 units.
 *
 * `"\u{1F9CA}".length` is 2, so `String.length` would charge an owner two
 * characters for one emoji and reject a 30-emoji display name as 60. The
 * product is about emoji; getting this wrong makes the documented limit mean
 * something other than what it says.
 *
 * `Array.from` drives the string iterator, which yields one entry per code
 * point — a surrogate pair never splits in half — and is not spread syntax, so
 * it does not trip `no-misused-spread`. `reserved-handles.ts` and
 * `canonicalise.ts` count the same way for the same reason.
 *
 * Note it is code points, not grapheme clusters: a flag or a ZWJ sequence costs
 * more than one. That matches how the database will count (`char_length`
 * counts code points) and how the Handle key is defined, and a limit the
 * storage layer disagrees with is a limit that fails at the write.
 */
function countCodePoints(value: string): number {
  return Array.from(value).length;
}

/**
 * Parse a URL, or say it is not one.
 *
 * The scheme is read back off {@link URL.protocol} and never off the raw
 * string. The WHATWG parser lower-cases the scheme and strips leading
 * whitespace and embedded tabs and newlines from it, so `JavaScript:`,
 * `" javascript:"` and `"java\tscript:"` all parse to the protocol
 * `javascript:` and all reach a visitor's browser as working script URLs —
 * while a `startsWith("http")` check on the raw string waves every one of them
 * through. Comparing the parsed protocol is what closes that.
 */
function parseUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function violationsForLink(
  link: ProfileLinkDraft,
  index: number,
): readonly ProfileViolation[] {
  const violations: ProfileViolation[] = [];

  const titleLength = countCodePoints(link.title);
  if (titleLength > LINK_TITLE_MAX_LENGTH) {
    violations.push({
      field: "link.title",
      index,
      rule: "too-long",
      limit: LINK_TITLE_MAX_LENGTH,
      length: titleLength,
    });
  }

  const url = parseUrl(link.url);
  if (url === undefined) {
    violations.push({ field: "link.url", index, rule: "malformed-url" });
    return violations;
  }
  if (!ALLOWED_LINK_SCHEMES.includes(url.protocol)) {
    violations.push({
      field: "link.url",
      index,
      rule: "unsupported-scheme",
      scheme: url.protocol,
    });
  }

  return violations;
}

/**
 * Check a Profile draft against the limits in `data-model.md` § Profile.
 *
 * It returns a result rather than throwing, and the result names the field and
 * the rule rather than answering yes or no — see
 * {@link ProfileValidationResult}. Every violation is reported, in a fixed
 * order.
 *
 * @param draft The Profile's editable fields, as submitted.
 */
export function validateProfile(draft: ProfileDraft): ProfileValidationResult {
  const violations: ProfileViolation[] = [];

  const displayNameLength = countCodePoints(draft.displayName);
  if (displayNameLength > DISPLAY_NAME_MAX_LENGTH) {
    violations.push({
      field: "displayName",
      rule: "too-long",
      limit: DISPLAY_NAME_MAX_LENGTH,
      length: displayNameLength,
    });
  }

  const bioLength = countCodePoints(draft.bio);
  if (bioLength > BIO_MAX_LENGTH) {
    violations.push({
      field: "bio",
      rule: "too-long",
      limit: BIO_MAX_LENGTH,
      length: bioLength,
    });
  }

  if (draft.links.length > LINK_LIMIT) {
    violations.push({
      field: "links",
      rule: "too-many",
      limit: LINK_LIMIT,
      count: draft.links.length,
    });
  }

  // Every Link is checked, including the ones past the limit: the owner has to
  // see every problem at once, and which Links to drop is their choice, not a
  // consequence of where the check stopped.
  draft.links.forEach((link, index) => {
    violations.push(...violationsForLink(link, index));
  });

  if (violations.length === 0) {
    return { ok: true };
  }
  return { ok: false, violations };
}
