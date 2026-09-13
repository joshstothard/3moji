import en from "../../../../packages/shared/messages/en.json";

/**
 * No personal details in the legal copy
 * ([#196](https://github.com/joshstothard/3moji/issues/196)).
 *
 * The operator is identified only by placeholders the owner replaces, so the
 * copy must carry no email address, no UK postcode, and no bracketed
 * placeholder that fails to say who fills it in.
 */
function stringsIn(value: unknown): readonly string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (typeof value === "object" && value !== null) {
    return Object.values(value).flatMap(stringsIn);
  }
  return [];
}

const legalStrings = stringsIn(en.Legal);

describe("the legal copy", () => {
  it("has copy to check", () => {
    expect(legalStrings.length).toBeGreaterThan(20);
  });

  it("contains no email address", () => {
    for (const text of legalStrings) {
      expect(text).not.toMatch(/[^\s@]+@[^\s@]+\.[^\s@]+/);
    }
  });

  it("contains no UK postcode", () => {
    for (const text of legalStrings) {
      expect(text).not.toMatch(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/);
    }
  });

  it("marks every placeholder as the owner's to fill in", () => {
    const placeholders = legalStrings.flatMap(
      (text) => text.match(/\[[^\]]*\]/g) ?? [],
    );

    expect(placeholders.length).toBeGreaterThan(0);
    for (const placeholder of placeholders) {
      expect(placeholder).toMatch(/the owner/);
    }
  });

  it("uses only the operator and contact tokens", () => {
    const tokens = legalStrings.flatMap((text) => text.match(/\{\w+\}/g) ?? []);

    expect(new Set(tokens)).toEqual(new Set(["{operator}", "{contact}"]));
  });
});
