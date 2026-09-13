import en from "../../../../packages/shared/messages/en.json";

/**
 * The link every claimed Profile offers for reporting it: a `mailto:` to the
 * address in `REPORT_CONTACT_EMAIL`, with the Handle's canonical path in the
 * subject ([#197](https://github.com/joshstothard/3moji/issues/197)).
 *
 * A Profile of links on a fresh domain is a known phishing pattern, and this is
 * the channel a report arrives through. What happens to one is
 * `docs/runbooks/takedown.md`. It is reporting, not moderation: nothing here
 * inspects a Profile.
 *
 * **Server-only, and a function of configuration and the path alone.** It reads
 * no session, no cookie and no request header, so the Profile it is rendered on
 * stays identical for every visitor and as cacheable as it was without it.
 */

/**
 * One plain address and nothing else.
 *
 * Deliberately narrower than RFC 5321 allows. Everything that could carry a
 * second mailto header or recipient is outside the character classes: `?`,
 * `&`, `=`, `#`, `%` (so `%0D%0A` cannot be smuggled through as an escape), `,`,
 * `;`, `<`, `>`, whitespace and every control character. A real mailbox the
 * owner chooses fits it; a value that does not is refused rather than repaired.
 */
const PLAIN_ADDRESS = /^[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

/** RFC 5321's limit on a forward-path, which is the longest address that works. */
const MAX_ADDRESS_LENGTH = 254;

/**
 * The address reports go to, or `undefined` when there is none to use.
 *
 * **Unset, empty or unusable all mean no link**, never a guessed or default
 * mailbox: a report sent to an address nobody reads is worse than a page that
 * offers no report link, because the reporter believes it was received. The
 * value is not trimmed either — a pasted value with a stray line break is
 * exactly the kind of mistake that should show up as a missing link on a
 * preview deployment rather than be quietly corrected.
 */
export function reportContactAddress(): string | undefined {
  const value = process.env.REPORT_CONTACT_EMAIL;
  if (value === undefined || value === "") return undefined;
  if (value.length > MAX_ADDRESS_LENGTH) return undefined;
  if (!PLAIN_ADDRESS.test(value)) return undefined;
  return value;
}

/**
 * The report link for the Handle at `encoded` — the percent-encoded canonical
 * segment, as the route canonicalised it — or `undefined` when no address is
 * configured.
 *
 * **The subject names the canonical emoji path**, whichever grammar the
 * reporter arrived by: it is the one address that names exactly one Handle
 * (ADR-0008 decision 5), and the one the takedown runbook starts from. It is
 * ASCII, so it survives any mail client, and the whole subject goes through
 * `encodeURIComponent` — which turns the path's own `%` into `%25`, so the
 * subject a moderator reads is the path itself rather than raw bytes, and
 * leaves no `&`, `=`, `?` or line break with which a value could start another
 * header.
 */
export function reportLinkOf(encoded: string): string | undefined {
  const address = reportContactAddress();
  if (address === undefined) return undefined;

  // A replacer function, so a `$` in the path is never read as a pattern.
  const subject = en.HandlePage.reportSubject.replace(
    "{path}",
    () => `/${encoded}`,
  );
  return `mailto:${address}?subject=${encodeURIComponent(subject)}`;
}

/**
 * The footer's report link, on every page
 * ([#198](https://github.com/joshstothard/3moji/issues/198)), or `undefined`
 * when no address is configured.
 *
 * **Same mailbox, same check.** The address comes from
 * {@link reportContactAddress}, so a value that would be refused on a Profile is
 * refused here too, and there is one place that decides what an address is.
 *
 * **It names no page**, because the footer is rendered by the root layout and
 * knowing the page would mean reading the request, which would make every page
 * vary by request. The body asks the reporter for the address instead. Both
 * are fixed copy, and both go through `encodeURIComponent`.
 */
export function siteReportLink(): string | undefined {
  const address = reportContactAddress();
  if (address === undefined) return undefined;

  const subject = encodeURIComponent(en.Footer.reportSubject);
  const body = encodeURIComponent(en.Footer.reportBody);
  return `mailto:${address}?subject=${subject}&body=${body}`;
}
