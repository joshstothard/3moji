/**
 * @jest-environment node
 */

import { redactAnalyticsEvent } from "./analytics-redaction";

/**
 * What Vercel Web Analytics may be told about a page view (PR #238).
 *
 * Written from the requirement, not from the implementation: no URL that can
 * carry a password reset token, an email or any other secret may reach the
 * analytics data. The set-new-password page holds a live, single-use token in
 * its path, and every query string and fragment is dropped wholesale so no
 * page's parameters are ever recorded.
 */
const TOKEN = "k7Q2xR9mZpL4vN8wT1yB";

function pageView(url: string): { type: "pageview"; url: string } {
  return { type: "pageview", url };
}

describe("redacting analytics events", () => {
  it.each([
    [
      "an absolute URL",
      `https://example.com/reset-password/${TOKEN}`,
      "https://example.com/reset-password/[token]",
    ],
    ["a relative URL", `/reset-password/${TOKEN}`, "/reset-password/[token]"],
    [
      "the refused-password redirect, which adds ?error=",
      `https://example.com/reset-password/${TOKEN}?error=mismatch`,
      "https://example.com/reset-password/[token]",
    ],
    [
      "a percent-encoded token with further segments",
      `/reset-password/${TOKEN}%2Fextra/more#top`,
      "/reset-password/[token]",
    ],
    [
      "a differently cased path, which the 404 page still records",
      `https://example.com/Reset-Password/${TOKEN}`,
      "https://example.com/reset-password/[token]",
    ],
  ])("replaces the reset token in %s", (_name, url, expected) => {
    const redacted = redactAnalyticsEvent(pageView(url));

    expect(redacted).toEqual(pageView(expected));
    expect(JSON.stringify(redacted)).not.toContain(TOKEN);
  });

  it.each([
    [
      "the Find a Handle lookup's typed words",
      "https://example.com/find?q=smile",
      "https://example.com/find",
    ],
    [
      "a relative URL's query",
      "/claim/held?reason=link-unknown&notice=sent",
      "/claim/held",
    ],
    [
      "a token-shaped query parameter",
      `https://example.com/reset-password?token=${TOKEN}`,
      "https://example.com/reset-password",
    ],
    [
      "an email in a query parameter",
      "/sign-in?email=someone%40example.com",
      "/sign-in",
    ],
    [
      "a fragment",
      "https://example.com/privacy#processors",
      "https://example.com/privacy",
    ],
  ])("strips %s", (_name, url, expected) => {
    expect(redactAnalyticsEvent(pageView(url))).toEqual(pageView(expected));
  });

  it.each([
    "https://example.com/",
    "https://example.com/privacy",
    "/reset-password",
    "/claim/verified/%F0%9F%A7%8A",
  ])("leaves %s as it is", (url) => {
    expect(redactAnalyticsEvent(pageView(url))).toEqual(pageView(url));
  });

  it("keeps every other field of the event", () => {
    const event = {
      type: "event" as const,
      name: "claimed",
      url: `https://example.com/reset-password/${TOKEN}?error=failed`,
    };

    expect(redactAnalyticsEvent(event)).toEqual({
      type: "event",
      name: "claimed",
      url: "https://example.com/reset-password/[token]",
    });
  });

  it("does not change the event it was given", () => {
    const event = pageView(`/reset-password/${TOKEN}`);

    redactAnalyticsEvent(event);

    expect(event.url).toBe(`/reset-password/${TOKEN}`);
  });

  it.each(["http://[::1", "https://exa mple.com/reset-password/x"])(
    "drops an event whose URL %s cannot be parsed, without throwing",
    (url) => {
      expect(() => redactAnalyticsEvent(pageView(url))).not.toThrow();
      expect(redactAnalyticsEvent(pageView(url))).toBeNull();
    },
  );
});
