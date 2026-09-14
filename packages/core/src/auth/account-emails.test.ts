import en from "@template/shared/messages/en.json";

import { passwordResetEmail, verificationEmail } from "./account-emails";
import { escapeHtml } from "./email-template";

const FROM = "3moji <no-reply@example.com>";
const VERIFY_LINK = "https://example.com/claim/verify?token=abc.def-ghi";
const RESET_LINK = "https://example.com/reset-password/tok_en-1";

const urlsIn = (value: string): string[] =>
  value.match(/https?:\/\/[^\s"<]+/g) ?? [];

describe("verificationEmail (#240)", () => {
  const email = verificationEmail({
    to: "someone@example.com",
    link: VERIFY_LINK,
    from: FROM,
  });
  const copy = en.Email.verification;

  it("is multipart, with the link in both parts", () => {
    expect(urlsIn(email.text)).toEqual([VERIFY_LINK]);
    expect(email.html).toContain(`href="${escapeHtml(VERIFY_LINK)}"`);
    expect(email.html).toContain('<html lang="en">');
  });

  it("takes every word from the Email.verification i18n keys", () => {
    expect(email.to).toBe("someone@example.com");
    expect(email.subject).toBe(copy.subject);
    for (const words of [copy.heading, copy.intro, copy.hold, copy.expired]) {
      expect(email.text).toContain(words);
      expect(email.html).toContain(escapeHtml(words));
    }
    expect(email.text).toContain(`${copy.action}: ${VERIFY_LINK}`);
    expect(email.html).toMatch(new RegExp(`<a [^>]*>${copy.action}</a>`));
    expect(email.text).toContain(en.Email.from.replace("{from}", FROM));
  });

  it('escapes a link carrying <, " and & in the HTML part only', () => {
    const hostile = 'https://example.com/claim/verify?token=a&b="<c>"';
    const escaped = verificationEmail({
      to: "someone@example.com",
      link: hostile,
      from: FROM,
    });

    expect(escaped.html).not.toContain('"<c>"');
    expect(escaped.html).toContain(
      "https://example.com/claim/verify?token=a&amp;b=&quot;&lt;c&gt;&quot;",
    );
    expect(escaped.text).toContain(hostile);
  });

  it("keeps the token out of the subject", () => {
    expect(email.subject).not.toContain("abc.def-ghi");
  });
});

describe("passwordResetEmail (#240)", () => {
  const email = passwordResetEmail({
    to: "reset@example.com",
    link: RESET_LINK,
    from: FROM,
  });
  const copy = en.Email.passwordReset;

  it("is multipart, with the link in both parts", () => {
    expect(urlsIn(email.text)).toEqual([RESET_LINK]);
    expect(email.html).toContain(`href="${escapeHtml(RESET_LINK)}"`);
    expect(email.html).toContain('<html lang="en">');
  });

  it("takes every word from the Email.passwordReset i18n keys", () => {
    expect(email.to).toBe("reset@example.com");
    expect(email.subject).toBe(copy.subject);
    for (const words of [copy.heading, copy.intro, copy.once, copy.ignore]) {
      expect(email.text).toContain(words);
      expect(email.html).toContain(escapeHtml(words));
    }
    expect(email.text).toContain(`${copy.action}: ${RESET_LINK}`);
  });

  it("keeps the token out of the subject", () => {
    expect(email.subject).not.toContain("tok_en-1");
  });
});
