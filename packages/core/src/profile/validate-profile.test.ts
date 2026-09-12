import {
  BIO_MAX_LENGTH,
  DISPLAY_NAME_MAX_LENGTH,
  LINK_LIMIT,
  LINK_TITLE_MAX_LENGTH,
  validateProfile,
  type ProfileDraft,
  type ProfileLinkDraft,
} from "./validate-profile";

/**
 * A single **astral** code point: U+1F9CA, whose `String.length` is 2 because
 * UTF-16 stores it as a surrogate pair. Deliberately not a ZWJ sequence and
 * not an emoji carrying U+FE0F — either would make "30 characters" mean
 * something other than what these tests claim.
 */
const ICE_CUBE = "\u{1F9CA}";

function draft(overrides: Partial<ProfileDraft> = {}): ProfileDraft {
  return {
    displayName: "Ice Cube",
    bio: "Three emoji, said aloud.",
    links: [],
    ...overrides,
  };
}

function link(overrides: Partial<ProfileLinkDraft> = {}): ProfileLinkDraft {
  return { title: "Home", url: "https://example.com", ...overrides };
}

/** `count` otherwise-valid Links, so a count assertion fails for one reason. */
function links(count: number): readonly ProfileLinkDraft[] {
  return Array.from({ length: count }, (_unused, index) =>
    link({ title: `Link ${String(index)}` }),
  );
}

describe("validateProfile", () => {
  it("accepts a Profile inside every limit", () => {
    expect(validateProfile(draft({ links: links(LINK_LIMIT) }))).toEqual({
      ok: true,
    });
  });

  describe("display name", () => {
    it("accepts exactly 30 characters", () => {
      expect(validateProfile(draft({ displayName: "a".repeat(30) }))).toEqual({
        ok: true,
      });
    });

    it("rejects 31 characters, naming the field and the rule", () => {
      expect(validateProfile(draft({ displayName: "a".repeat(31) }))).toEqual({
        ok: false,
        violations: [
          {
            field: "displayName",
            rule: "too-long",
            limit: DISPLAY_NAME_MAX_LENGTH,
            length: 31,
          },
        ],
      });
    });

    /**
     * The code-point rule. 30 astral emoji are 30 characters to the owner and
     * 60 UTF-16 units to `String.length`, so an implementation counting units
     * rejects this Profile.
     */
    it("accepts 30 emoji, which String.length would call 60", () => {
      const displayName = ICE_CUBE.repeat(30);
      expect(displayName.length).toBe(60);

      expect(validateProfile(draft({ displayName }))).toEqual({ ok: true });
    });

    it("rejects 31 emoji and reports the length in code points", () => {
      expect(
        validateProfile(draft({ displayName: ICE_CUBE.repeat(31) })),
      ).toEqual({
        ok: false,
        violations: [
          {
            field: "displayName",
            rule: "too-long",
            limit: DISPLAY_NAME_MAX_LENGTH,
            length: 31,
          },
        ],
      });
    });
  });

  describe("bio", () => {
    it("accepts exactly 160 characters", () => {
      expect(validateProfile(draft({ bio: "b".repeat(160) }))).toEqual({
        ok: true,
      });
    });

    it("rejects 161 characters", () => {
      expect(validateProfile(draft({ bio: "b".repeat(161) }))).toEqual({
        ok: false,
        violations: [
          {
            field: "bio",
            rule: "too-long",
            limit: BIO_MAX_LENGTH,
            length: 161,
          },
        ],
      });
    });

    it("counts a bio by code point too", () => {
      expect(validateProfile(draft({ bio: ICE_CUBE.repeat(160) }))).toEqual({
        ok: true,
      });
    });
  });

  describe("links", () => {
    it("accepts exactly 10 Links", () => {
      expect(validateProfile(draft({ links: links(10) }))).toEqual({
        ok: true,
      });
    });

    it("rejects 11 Links, reporting the count", () => {
      expect(validateProfile(draft({ links: links(11) }))).toEqual({
        ok: false,
        violations: [
          { field: "links", rule: "too-many", limit: LINK_LIMIT, count: 11 },
        ],
      });
    });
  });

  describe("link title", () => {
    it("accepts exactly 40 characters", () => {
      expect(
        validateProfile(draft({ links: [link({ title: "t".repeat(40) })] })),
      ).toEqual({ ok: true });
    });

    it("rejects 41 characters, naming which Link", () => {
      expect(
        validateProfile(
          draft({ links: [link(), link({ title: "t".repeat(41) })] }),
        ),
      ).toEqual({
        ok: false,
        violations: [
          {
            field: "link.title",
            index: 1,
            rule: "too-long",
            limit: LINK_TITLE_MAX_LENGTH,
            length: 41,
          },
        ],
      });
    });

    it("counts a link title by code point", () => {
      expect(
        validateProfile(
          draft({ links: [link({ title: ICE_CUBE.repeat(40) })] }),
        ),
      ).toEqual({ ok: true });
    });
  });

  describe("link URL scheme", () => {
    it.each(["http://example.com/x", "https://example.com/x"])(
      "accepts %s",
      (url) => {
        expect(validateProfile(draft({ links: [link({ url })] }))).toEqual({
          ok: true,
        });
      },
    );

    /**
     * The scheme check is a **security control**, not a format check: a Profile
     * renders owner-supplied URLs to visitors, so `javascript:` and `data:` are
     * the cases that matter. The WHATWG parser lower-cases a scheme and strips
     * leading whitespace and embedded tabs from it, so each of these reaches a
     * visitor's browser as a working `javascript:` URL while a `startsWith`
     * check on the raw string waves it through.
     */
    it.each([
      ["a javascript: URL", "javascript:alert(1)", "javascript:"],
      ["a mixed-case javascript: URL", "JavaScript:alert(1)", "javascript:"],
      ["a tab-split javascript: URL", "java\tscript:alert(1)", "javascript:"],
      ["a space-padded javascript: URL", " javascript:alert(1)", "javascript:"],
      ["a data: URL", "data:text/html;base64,PHNjcmlwdD4=", "data:"],
      ["a mailto: URL", "mailto:someone@example.com", "mailto:"],
    ])("rejects %s, naming the scheme", (_name, url, scheme) => {
      expect(validateProfile(draft({ links: [link({ url })] }))).toEqual({
        ok: false,
        violations: [
          {
            field: "link.url",
            index: 0,
            rule: "unsupported-scheme",
            scheme,
          },
        ],
      });
    });

    it("rejects a bare host with no scheme as malformed", () => {
      expect(
        validateProfile(draft({ links: [link({ url: "example.com" })] })),
      ).toEqual({
        ok: false,
        violations: [{ field: "link.url", index: 0, rule: "malformed-url" }],
      });
    });
  });

  /**
   * A form has to show everything that is wrong at once, so every violation is
   * reported rather than the first. The order is fixed — display name, bio,
   * link count, then per-Link ascending with title before URL — so the list is
   * a function of the input alone, which is the property `canonicalise`'s
   * leftmost-offender rule exists to give.
   */
  it("reports every violation, in a fixed order", () => {
    expect(
      validateProfile({
        displayName: "a".repeat(31),
        bio: "b".repeat(161),
        links: [
          ...links(10),
          link({ title: "t".repeat(41), url: "javascript:alert(1)" }),
        ],
      }),
    ).toEqual({
      ok: false,
      violations: [
        {
          field: "displayName",
          rule: "too-long",
          limit: DISPLAY_NAME_MAX_LENGTH,
          length: 31,
        },
        { field: "bio", rule: "too-long", limit: BIO_MAX_LENGTH, length: 161 },
        { field: "links", rule: "too-many", limit: LINK_LIMIT, count: 11 },
        {
          field: "link.title",
          index: 10,
          rule: "too-long",
          limit: LINK_TITLE_MAX_LENGTH,
          length: 41,
        },
        {
          field: "link.url",
          index: 10,
          rule: "unsupported-scheme",
          scheme: "javascript:",
        },
      ],
    });
  });

  it("does not throw on any rejection", () => {
    expect(() =>
      validateProfile(draft({ links: [link({ url: "javascript:alert(1)" })] })),
    ).not.toThrow();
  });
});
