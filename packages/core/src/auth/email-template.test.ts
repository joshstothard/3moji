import en from "@template/shared/messages/en.json";

import {
  escapeHtml,
  fillCopy,
  renderEmail,
  type EmailContent,
} from "./email-template";

const URL_WITH_QUERY = "https://example.com/claim/verify?token=a1&next=b2";
const FROM = "3moji <no-reply@example.com>";

const content = (overrides: Partial<EmailContent> = {}): EmailContent => ({
  subject: "Verify your email",
  heading: "Verify your email",
  before: ["Confirm this address."],
  action: { label: "Verify your email", url: URL_WITH_QUERY },
  after: ["The link works once."],
  from: FROM,
  ...overrides,
});

/** Every `http(s)://` URL in `value`, as written. */
const urlsIn = (value: string): string[] =>
  value.match(/https?:\/\/[^\s"<]+/g) ?? [];

describe("renderEmail (#240)", () => {
  it("produces both a text part and an HTML part", () => {
    const email = renderEmail("someone@example.com", content());

    expect(email.to).toBe("someone@example.com");
    expect(email.subject).toBe("Verify your email");
    expect(email.text.length).toBeGreaterThan(0);
    expect(email.html.length).toBeGreaterThan(0);
  });

  it("declares the language and a character set", () => {
    const { html } = renderEmail("someone@example.com", content());

    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain("<title>Verify your email</title>");
  });

  it("carries the same words in both parts", () => {
    const email = renderEmail("someone@example.com", content());

    for (const words of [
      "Verify your email",
      "Confirm this address.",
      "The link works once.",
    ]) {
      expect(email.text).toContain(words);
      expect(email.html).toContain(words);
    }
    expect(email.text).toContain(FROM);
    expect(email.html).toContain(escapeHtml(FROM));
  });

  it("gives the link descriptive text, and writes the address out as text too", () => {
    const { html } = renderEmail("someone@example.com", content());
    const escapedUrl = escapeHtml(URL_WITH_QUERY);

    // One real link, whose text says what it does rather than being the URL.
    expect(html.match(/<a\s/g)).toHaveLength(1);
    expect(html).toContain(`<a href="${escapedUrl}"`);
    expect(html).toMatch(/<a [^>]*>Verify your email<\/a>/);
    // The address again, as plain text, for a client that strips links.
    expect(html).toContain(en.Email.linkFallback);
    expect(html.split(escapedUrl)).toHaveLength(3);
  });

  it("writes the link once in the text part, beside its label", () => {
    const { text } = renderEmail("someone@example.com", content());

    expect(urlsIn(text)).toEqual([URL_WITH_QUERY]);
    expect(text).toContain(`Verify your email: ${URL_WITH_QUERY}`);
  });

  it("keeps the text part plain: no markup and no entities", () => {
    const { text } = renderEmail(
      "someone@example.com",
      content({ before: ['Tom & "Jerry" <b>'] }),
    );

    expect(text).toContain('Tom & "Jerry" <b>');
    expect(text).not.toMatch(/&amp;|&lt;|&quot;/);
    expect(text).not.toMatch(/<\/?(p|a|html|br)\b/);
  });

  it("loads nothing remote: no images, stylesheets, scripts or tracking", () => {
    const { html } = renderEmail("someone@example.com", content());

    expect(html).not.toMatch(/<img|<link|<script|<style|<iframe/i);
    expect(html).not.toMatch(/\ssrc=|url\(|@import/i);
    // The only address anywhere in the HTML is the action's own.
    expect(new Set(urlsIn(html))).toEqual(
      new Set([escapeHtml(URL_WITH_QUERY)]),
    );
  });

  it("styles inline, in colours that pass WCAG AA contrast on white", () => {
    const { html } = renderEmail("someone@example.com", content());

    // slate-900 body text, indigo-700 link, slate-600 footer: all above 7:1.
    expect(html).toContain("color:#0f172a");
    expect(html).toContain("color:#4338ca");
    expect(html).toContain("color:#475569");
    expect(html).toContain("background-color:#ffffff");
    // Not colour alone: the link is underlined.
    expect(html).toMatch(/<a [^>]*text-decoration:underline/);
  });

  describe("escaping every interpolated value", () => {
    const HOSTILE = `<script>alert("x")</script> & 'more'`;

    it("escapes a paragraph, the heading and the subject", () => {
      const { html } = renderEmail(
        "someone@example.com",
        content({ subject: HOSTILE, heading: HOSTILE, before: [HOSTILE] }),
      );

      expect(html).not.toContain("<script>");
      expect(html).not.toContain('"x"');
      expect(html).toContain(
        "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;more&#39;",
      );
    });

    it("escapes the link in the href and in the written-out address", () => {
      const url = 'https://example.com/?q="><img src=x>&a=<b>';
      const { html } = renderEmail(
        "someone@example.com",
        content({ action: { label: "Go", url } }),
      );

      expect(html).not.toContain('"><img');
      expect(html).not.toContain("<b>");
      const escaped =
        "https://example.com/?q=&quot;&gt;&lt;img src=x&gt;&amp;a=&lt;b&gt;";
      expect(html).toContain(`href="${escaped}"`);
      expect(html.split(escaped)).toHaveLength(3);
    });

    it("escapes the action's label", () => {
      const { html } = renderEmail(
        "someone@example.com",
        content({
          action: { label: 'Go "now" & <then>', url: URL_WITH_QUERY },
        }),
      );

      expect(html).toContain("Go &quot;now&quot; &amp; &lt;then&gt;</a>");
    });

    it("escapes the sender, whose angle brackets would otherwise swallow the rest", () => {
      const { html } = renderEmail("someone@example.com", content());

      expect(html).not.toContain("<no-reply@example.com>");
      expect(html).toContain("3moji &lt;no-reply@example.com&gt;");
    });
  });

  it("refuses an action that is not an http or https link, without echoing it", () => {
    const url = "javascript:alert(1)";

    expect(() =>
      renderEmail(
        "someone@example.com",
        content({ action: { label: "Go", url } }),
      ),
    ).toThrow(/http/);
    try {
      renderEmail(
        "someone@example.com",
        content({ action: { label: "Go", url } }),
      );
    } catch (error) {
      expect(error instanceof Error ? error.message : "").not.toContain(url);
    }
  });
});

describe("escapeHtml", () => {
  it("escapes the five characters that matter in text and attributes", () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
    );
  });

  it("escapes the ampersand first, so an entity is escaped rather than trusted", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("leaves emoji and ordinary text alone", () => {
    expect(escapeHtml("\u{1F9CA}\u{1F9CA}\u{1F9CA} three ice cubes")).toBe(
      "\u{1F9CA}\u{1F9CA}\u{1F9CA} three ice cubes",
    );
  });
});

describe("fillCopy", () => {
  it("fills every placeholder", () => {
    expect(
      fillCopy("From {from}, for {handle}", { from: "a", handle: "b" }),
    ).toBe("From a, for b");
  });

  it("inserts a value literally, even one that looks like a replacement pattern", () => {
    expect(fillCopy("owns {handle}", { handle: "$& $1 $$" })).toBe(
      "owns $& $1 $$",
    );
  });

  it("refuses a placeholder it was given no value for, naming only the placeholder", () => {
    expect(() => fillCopy("From {from}", {})).toThrow(/\{from\}/);
  });
});
