/**
 * The headers a client's network address is read from, in order of trust
 * ([#157](https://github.com/joshstothard/3moji/issues/157)).
 *
 * **What this trusts, exactly.** On Vercel, both headers are set by Vercel's
 * edge for every request: Vercel documents that it overwrites
 * `X-Forwarded-For` and does not forward external IPs, to prevent spoofing,
 * and that `x-vercel-forwarded-for` carries the same value but cannot be
 * overwritten by a proxy placed in front of Vercel. So the value is the address
 * that connected to Vercel — trusted **because the platform set it, and only
 * on Vercel**.
 *
 * Anywhere else — `next dev`, `next start`, a container, behind any proxy that
 * passes the client's header through — both are ordinary request headers a
 * client can write. There, the per-client-address limit can be sidestepped by
 * sending a different value each time, or aimed at somebody else's address;
 * the per-email limit is unaffected, because it does not read headers.
 */
export const CLIENT_ADDRESS_HEADERS = [
  "x-vercel-forwarded-for",
  "x-forwarded-for",
] as const;

/** The one method this needs from `Headers` or Next's `ReadonlyHeaders`. */
export interface HeaderReader {
  get(name: string): string | null;
}

/**
 * The client's network address as the forwarded headers state it, or
 * `undefined` when none does.
 *
 * The first header present wins, and its **first** comma-separated entry is
 * taken: the address that made the original request, when the header is a
 * list. It is not validated here — `clientAddressBucket` in `packages/core` is
 * the rule, and it puts anything that is not one IPv4 or IPv6 address into a
 * single shared `unknown` bucket.
 */
export function clientAddressFrom(headers: HeaderReader): string | undefined {
  for (const name of CLIENT_ADDRESS_HEADERS) {
    const value = headers.get(name);
    if (value === null) continue;
    const first = value.split(",")[0]?.trim() ?? "";
    return first === "" ? undefined : first;
  }
  return undefined;
}
