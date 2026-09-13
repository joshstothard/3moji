import { normaliseEmailAddress } from "./email-address";

/**
 * The one normalisation every email comparison agrees on (#163).
 *
 * Better Auth lowercases an address on sign-up, sign-in, change-email and its
 * user lookup, so the domain must use exactly that form — no more (no Unicode
 * case folding, no dot-stripping) and no less.
 */
describe("normaliseEmailAddress", () => {
  it("lowercases, the way Better Auth stores and looks up an address", () => {
    expect(normaliseEmailAddress("Someone@Example.COM")).toBe(
      "someone@example.com",
    );
  });

  it("trims surrounding whitespace, which a form field often carries", () => {
    expect(normaliseEmailAddress("  someone@example.com\t\n")).toBe(
      "someone@example.com",
    );
  });

  it("leaves an already-normal address unchanged", () => {
    expect(normaliseEmailAddress("someone@example.com")).toBe(
      "someone@example.com",
    );
  });

  it("changes nothing else about the address", () => {
    // Dots and plus-tags are meaningful to some providers; normalising them
    // would merge Accounts Better Auth keeps apart.
    expect(normaliseEmailAddress("First.Last+Tag@Example.com")).toBe(
      "first.last+tag@example.com",
    );
  });
});
