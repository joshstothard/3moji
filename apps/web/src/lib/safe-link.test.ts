/**
 * @jest-environment node
 */

import { safeLinkHref } from "./safe-link";

describe("the render-time scheme allowlist", () => {
  it.each([
    "https://example.com/",
    "http://example.com/path?q=1#frag",
    "HTTPS://EXAMPLE.COM/",
  ])("lets %s through", (url) => {
    expect(safeLinkHref(url)).toBeDefined();
  });

  it.each([
    ["plain script URL", "javascript:alert(1)"],
    ["mixed case", "JavaScript:alert(1)"],
    ["leading whitespace", " javascript:alert(1)"],
    ["embedded tab", "java\tscript:alert(1)"],
    ["embedded newline", "java\nscript:alert(1)"],
    ["data URL", "data:text/html,<script>alert(1)</script>"],
    // The two a `startsWith("http")` prefix test waves through. Their parsed
    // protocols are `httpfoo:` and `https-evil:`, which is why the allowlist
    // compares `URL.protocol` and never the raw string.
    ["scheme that merely starts with http", "httpfoo://evil.example"],
    ["hyphenated near-miss", "https-evil:alert(1)"],
    ["vbscript", "vbscript:msgbox(1)"],
    ["blob", "blob:https://example.com/1234"],
  ])("refuses a %s", (_name, url) => {
    expect(safeLinkHref(url)).toBeUndefined();
  });

  it.each(["", "not a url at all", "://missing-scheme"])(
    "refuses %s, which is not a URL",
    (url) => {
      expect(safeLinkHref(url)).toBeUndefined();
    },
  );

  it("answers with the parser's own serialisation, not the raw string", () => {
    // Whatever reaches the attribute has been through the WHATWG parser, so a
    // stray tab or leading space cannot survive into the markup as something
    // the browser re-reads differently from the way this guard read it.
    expect(safeLinkHref("  https://example.com")).toBe("https://example.com/");
  });
});
