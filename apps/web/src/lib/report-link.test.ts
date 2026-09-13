/**
 * @jest-environment node
 */

/**
 * The report link: a `mailto:` to the address in `REPORT_CONTACT_EMAIL`, with
 * the Handle's canonical path in the subject
 * ([#197](https://github.com/joshstothard/3moji/issues/197)).
 *
 * The address is configuration, and configuration is input: a value pasted
 * into a hosting dashboard with a stray `?cc=` or a line break would otherwise
 * turn every Profile's report link into a link that copies somebody else in,
 * or rewrites the body. So everything that is not plainly one address means
 * **no link**, and these tests assert absence rather than a cleaned-up link.
 */
import {
  reportContactAddress,
  reportLinkOf,
  siteReportLink,
} from "./report-link";
import en from "../../../../packages/shared/messages/en.json";

const ADDRESS = "reports@example.com";
/** 🧊🧊🧊, as the route hands it over: the percent-encoded canonical segment. */
const ENCODED = "%F0%9F%A7%8A%F0%9F%A7%8A%F0%9F%A7%8A";

const saved = process.env.REPORT_CONTACT_EMAIL;

function setAddress(value: string | undefined): void {
  if (value === undefined)
    Reflect.deleteProperty(process.env, "REPORT_CONTACT_EMAIL");
  else process.env.REPORT_CONTACT_EMAIL = value;
}

afterAll(() => {
  setAddress(saved);
});

beforeEach(() => {
  setAddress(ADDRESS);
});

/** Every header a `mailto:` URL carries, as RFC 6068 would read it. */
function headersOf(href: string): Map<string, string> {
  const query = href.slice(href.indexOf("?") + 1);
  return new Map(
    query.split("&").map((field) => {
      const [name = "", value = ""] = field.split("=");
      return [
        decodeURIComponent(name).toLowerCase(),
        decodeURIComponent(value),
      ];
    }),
  );
}

describe("the report contact address", () => {
  it("is REPORT_CONTACT_EMAIL when that is one plain address", () => {
    expect(reportContactAddress()).toBe(ADDRESS);
  });

  it.each([
    ["unset", undefined],
    ["empty", ""],
  ])("is absent when the variable is %s", (_name, value) => {
    setAddress(value);

    expect(reportContactAddress()).toBeUndefined();
  });

  it.each([
    ["a missing @", "reports.example.com"],
    ["two @", "reports@abuse@example.com"],
    ["no domain dot", "reports@localhost"],
    ["a display name", "3moji <reports@example.com>"],
    ["a comma-separated second address", `${ADDRESS},attacker@example.net`],
    ["a surrounding space", ` ${ADDRESS} `],
    ["a trailing line feed", `${ADDRESS}\n`],
    ["an overlong value", `${"a".repeat(250)}@example.com`],
  ])("is absent when the value has %s", (_name, value) => {
    setAddress(value);

    expect(reportContactAddress()).toBeUndefined();
  });
});

describe("the report link", () => {
  it("is a mailto: to the configured address", () => {
    const href = reportLinkOf(ENCODED);

    expect(href?.startsWith(`mailto:${ADDRESS}?`)).toBe(true);
  });

  it("carries the Handle's canonical path in the subject, and nothing else", () => {
    const href = reportLinkOf(ENCODED) ?? "";

    expect([...headersOf(href).keys()]).toEqual(["subject"]);
    expect(headersOf(href).get("subject")).toBe(
      en.HandlePage.reportSubject.replace("{path}", `/${ENCODED}`),
    );
  });

  it("encodes the subject, so the path's own % signs survive the mail client", () => {
    const href = reportLinkOf(ENCODED) ?? "";

    // `%F0` unencoded would be decoded by the mail client into a raw byte, and
    // the subject would no longer be the path a moderator can paste.
    expect(href).toContain("%25F0%259F%25A7%258A");
    expect(href).not.toMatch(/[\s<>"]/);
  });

  it("is absent when no address is configured, rather than a link to nobody", () => {
    setAddress(undefined);

    expect(reportLinkOf(ENCODED)).toBeUndefined();
  });

  /*
   * The injection cases. Every one would add a header, a recipient or a body
   * to the mailto if the value were concatenated as given; each must produce
   * no link at all. Control characters are written as escapes, never as bytes.
   */
  it.each([
    ["a ? starting its own headers", `${ADDRESS}?bcc=attacker@example.net`],
    ["an & adding a header", `${ADDRESS}&cc=attacker@example.net`],
    ["a CR/LF header", `${ADDRESS}\r\nBcc: attacker@example.net`],
    ["a bare CR", `${ADDRESS}\rBcc: attacker@example.net`],
    ["a percent-encoded CR/LF", `${ADDRESS}%0D%0ABcc:attacker@example.net`],
    ["a fragment", `${ADDRESS}#body=hello`],
    ["a percent-encoded ?", `${ADDRESS}%3Fbcc=attacker@example.net`],
  ])("is absent when the variable carries %s", (_name, value) => {
    setAddress(value);

    expect(reportLinkOf(ENCODED)).toBeUndefined();
  });

  it("cannot be given a second header by the path it is handed", () => {
    const href = reportLinkOf("x&bcc=attacker@example.net\r\nCc: y") ?? "";

    expect([...headersOf(href).keys()]).toEqual(["subject"]);
    expect(href).not.toMatch(/[\r\n]/);
  });
});

/*
 * The footer's report entry (#198): the same mailbox and the same address
 * check, for a page the footer cannot name without reading the request.
 */
describe("the site-wide report link", () => {
  it("is a mailto: to the configured address", () => {
    expect(siteReportLink()?.startsWith(`mailto:${ADDRESS}?`)).toBe(true);
  });

  it("carries a subject and a body asking for the page's address, and nothing else", () => {
    const href = siteReportLink() ?? "";

    expect([...headersOf(href).keys()]).toEqual(["subject", "body"]);
    expect(headersOf(href).get("subject")).toBe(en.Footer.reportSubject);
    expect(headersOf(href).get("body")).toBe(en.Footer.reportBody);
    expect(href).not.toMatch(/[\s<>"]/);
  });

  it("is absent when no address is configured", () => {
    setAddress(undefined);

    expect(siteReportLink()).toBeUndefined();
  });

  it.each([
    ["a ? starting its own headers", `${ADDRESS}?bcc=attacker@example.net`],
    ["a CR/LF header", `${ADDRESS}\r\nBcc: attacker@example.net`],
    ["a percent-encoded CR/LF", `${ADDRESS}%0D%0ABcc:attacker@example.net`],
  ])("is absent when the variable carries %s", (_name, value) => {
    setAddress(value);

    expect(siteReportLink()).toBeUndefined();
  });
});
