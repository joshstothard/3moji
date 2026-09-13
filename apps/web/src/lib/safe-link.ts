/**
 * The scheme allowlist applied **at the render**, to a URL somebody else typed.
 *
 * `validateProfile` in `packages/core` already refuses anything but `http:` and
 * `https:` when a Profile is saved. This is the second layer, and it is
 * deliberately an **independent** encoding of the same rule rather than an
 * import of `ALLOWED_LINK_SCHEMES` — `docs/development/engineering-standards.md`
 * asks for defence in depth whose layers fail independently, and a shared
 * constant is a single edit that switches both the write-path rejection and the
 * render-path refusal off at once. Please do not DRY these two together.
 *
 * There is a real gap for it to cover: a `link` row can predate the write-path
 * guard, arrive from a migration or a fixture, or be written by a future path
 * that forgets to validate, and the page is the last place before a visitor's
 * browser treats `javascript:` as executable.
 *
 * **The scheme is read off {@link URL.protocol} and never off the raw string**,
 * for the reason `data-model.md` § Profile spells out: the WHATWG parser
 * lower-cases a scheme and strips leading whitespace, tabs and newlines out of
 * it, so `JavaScript:`, `" javascript:"` and `"java\tscript:"` all reach a
 * browser as working script URLs while a `startsWith("http")` test waves every
 * one of them through — and admits `httpfoo://evil.example` besides.
 */
const ALLOWED_SCHEMES: readonly string[] = ["http:", "https:"];

/**
 * The `href` this URL may be rendered with, or `undefined` if it may not be
 * rendered as a link at all.
 *
 * The answer is the **parser's own serialisation**, not the string it was
 * handed, so nothing a browser would re-read differently — a leading space, an
 * embedded tab — survives into the attribute.
 *
 * @param url An owner-supplied URL, exactly as it came out of the database.
 */
export function safeLinkHref(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Not a URL at all. Nothing to link to, and nothing to guess at.
    return undefined;
  }

  return ALLOWED_SCHEMES.includes(parsed.protocol) ? parsed.href : undefined;
}
