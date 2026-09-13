/**
 * The response headers that do not change per request (#205).
 *
 * They are set from `next.config.ts`, not from the proxy, because the proxy's
 * matcher skips `_next/static`, `_next/image` and the metadata files, and
 * HSTS and `nosniff` must reach those too. What is asserted is the config Next
 * reads, so a rule that drifts from the list, or narrows its `source`, fails
 * here rather than silently in production.
 */
import nextConfig from "../../next.config";

import { STATIC_SECURITY_HEADERS } from "./security-headers";

function valueOf(name: string): string | undefined {
  return STATIC_SECURITY_HEADERS.find(
    (header) => header.key.toLowerCase() === name.toLowerCase(),
  )?.value;
}

describe("the static security headers", () => {
  it("pins HTTPS for two years, including subdomains", () => {
    expect(valueOf("Strict-Transport-Security")).toBe(
      "max-age=63072000; includeSubDomains",
    );
  });

  it("stops the browser sniffing a content type", () => {
    expect(valueOf("X-Content-Type-Options")).toBe("nosniff");
  });

  it("sends only the origin to another site", () => {
    expect(valueOf("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });

  it("refuses framing for browsers that predate frame-ancestors", () => {
    expect(valueOf("X-Frame-Options")).toBe("DENY");
  });
});

describe("next.config.ts", () => {
  it("sends the static security headers on every path", async () => {
    const rules = await nextConfig.headers?.();

    expect(rules).toEqual([
      { source: "/:path*", headers: [...STATIC_SECURITY_HEADERS] },
    ]);
  });
});
