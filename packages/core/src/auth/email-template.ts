import en from "@template/shared/messages/en.json";

import type { OutboundEmail } from "./ports/email-sender";

/**
 * The copy every email is written in: the `Email` namespace of
 * `packages/shared/messages/en.json`, the same file the web app's copy lives
 * in ([#240](https://github.com/joshstothard/3moji/issues/240)).
 */
export const EMAIL_COPY = en.Email;

/** The language `EMAIL_COPY` is written in, declared on the HTML part. */
export const EMAIL_LANG = "en";

/**
 * One email's content, before it is rendered into its two parts.
 *
 * Every string here is **plain text**, never markup: `renderEmail` escapes
 * each one for the HTML part and uses it as-is for the text part.
 */
export interface EmailContent {
  readonly subject: string;
  readonly heading: string;
  /** Paragraphs before the link. */
  readonly before: readonly string[];
  /** The one thing the email asks the reader to do. */
  readonly action: { readonly label: string; readonly url: string };
  /** Paragraphs after the link. */
  readonly after: readonly string[];
  /** The verified sender, e.g. `3moji <no-reply@mail.3moji.me>`. */
  readonly from: string;
}

/**
 * Escapes text for an HTML text node **or** a double- or single-quoted
 * attribute value. `&` goes first, so an entity already in the value is
 * escaped rather than trusted.
 */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Fills `{name}` placeholders in a copy string, the same shape the web app's
 * copy uses.
 *
 * Values are inserted **literally**, through a replacer function: a string
 * replacement would read `$&` in a value as a pattern. A placeholder with no
 * value throws, naming the placeholder and never a value, since a value can be
 * a link carrying a token.
 */
export function fillCopy(
  template: string,
  values: Readonly<Record<string, string>>,
): string {
  return template.replace(/\{([A-Za-z]+)\}/g, (_match, name: string) => {
    const value = values[name];
    if (value === undefined) {
      throw new Error(`Email copy placeholder {${name}} has no value.`);
    }
    return value;
  });
}

// Inline styles only: many clients strip <style>, and nothing is loaded from
// anywhere. Colours are Tailwind's slate-900, indigo-700 and slate-600 on
// white, each above 7:1, so they pass WCAG AA with room to spare.
const BODY_STYLE = "margin:0;padding:0;background-color:#ffffff;";
const WRAPPER_STYLE =
  "max-width:560px;margin:0 auto;padding:24px;background-color:#ffffff;color:#0f172a;font-family:Arial, Helvetica, sans-serif;font-size:16px;line-height:1.5;";
const HEADING_STYLE =
  "margin:0 0 16px;font-size:22px;line-height:1.3;color:#0f172a;";
const PARAGRAPH_STYLE = "margin:0 0 16px;";
const LINK_STYLE = "color:#4338ca;font-weight:bold;text-decoration:underline;";
const ADDRESS_STYLE = "word-break:break-all;";
const FOOTER_STYLE = "margin:24px 0 0;font-size:14px;color:#475569;";

const paragraph = (text: string): string =>
  `<p style="${PARAGRAPH_STYLE}">${escapeHtml(text)}</p>`;

/**
 * Renders one email as **multipart**: a `text` part and an `html` part that
 * carry the same content ([#240](https://github.com/joshstothard/3moji/issues/240)).
 *
 * The HTML is deliberately plain: a `lang` attribute, a heading, paragraphs,
 * one link whose text says what it does, and the same address written out as
 * text for a client that strips links. No images, no remote CSS, no tracking,
 * so it reads the same with images off. **Every value is escaped**, the link
 * included, in the `href` and in the written-out address alike.
 *
 * The text part writes the link **once**, beside its label, so a reader (or a
 * test) finds exactly one address in it.
 *
 * An action that is not an `http` or `https` link throws, and the message does
 * not repeat it: every link is built from the configured base URL, so anything
 * else is a defect, and a `javascript:` URL in an `href` would be a live one.
 */
export function renderEmail(to: string, content: EmailContent): OutboundEmail {
  const { action } = content;
  if (!/^https?:\/\//i.test(action.url)) {
    throw new Error(
      "renderEmail requires the action link to be an http or https URL.",
    );
  }

  const fromLine = fillCopy(EMAIL_COPY.from, { from: content.from });

  const text = [
    content.heading,
    ...content.before,
    `${action.label}: ${action.url}`,
    ...content.after,
    fromLine,
  ].join("\n\n");

  const url = escapeHtml(action.url);
  const html = [
    "<!doctype html>",
    `<html lang="${EMAIL_LANG}">`,
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(content.subject)}</title>`,
    "</head>",
    `<body style="${BODY_STYLE}">`,
    `<div style="${WRAPPER_STYLE}">`,
    `<h1 style="${HEADING_STYLE}">${escapeHtml(content.heading)}</h1>`,
    ...content.before.map(paragraph),
    `<p style="${PARAGRAPH_STYLE}"><a href="${url}" style="${LINK_STYLE}">${escapeHtml(action.label)}</a></p>`,
    `<p style="${PARAGRAPH_STYLE}">${escapeHtml(EMAIL_COPY.linkFallback)}<br><span style="${ADDRESS_STYLE}">${url}</span></p>`,
    ...content.after.map(paragraph),
    `<p style="${FOOTER_STYLE}">${escapeHtml(fromLine)}</p>`,
    "</div>",
    "</body>",
    "</html>",
  ].join("\n");

  return { to, subject: content.subject, text, html };
}
