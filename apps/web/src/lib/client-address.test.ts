/**
 * @jest-environment node
 */
import { CLIENT_ADDRESS_HEADERS, clientAddressFrom } from "./client-address";

const from = (headers: Readonly<Record<string, string>>) =>
  clientAddressFrom(new Headers(headers));

describe("clientAddressFrom", () => {
  it("reads Vercel's own header first, which a proxy in front of Vercel cannot overwrite", () => {
    expect(
      from({
        "x-vercel-forwarded-for": "203.0.113.7",
        "x-forwarded-for": "198.51.100.1",
      }),
    ).toBe("203.0.113.7");
  });

  it("falls back to x-forwarded-for, which Vercel also overwrites", () => {
    expect(from({ "x-forwarded-for": "198.51.100.1" })).toBe("198.51.100.1");
  });

  it("takes the first entry of a list, trimmed", () => {
    expect(from({ "x-forwarded-for": " 198.51.100.1 , 10.0.0.1" })).toBe(
      "198.51.100.1",
    );
  });

  it("answers undefined when no forwarded header is present", () => {
    expect(from({})).toBeUndefined();
  });

  it("answers undefined for an empty header rather than an empty address", () => {
    expect(from({ "x-vercel-forwarded-for": " " })).toBeUndefined();
  });

  it("does not validate the address: the domain does, and puts a bad one in the unknown bucket", () => {
    expect(from({ "x-forwarded-for": "not-an-address" })).toBe(
      "not-an-address",
    );
  });
});

describe("CLIENT_ADDRESS_HEADERS", () => {
  it("is the list Better Auth's own rate limiter is configured with, so both limiters key a client alike (#158)", () => {
    // Read from source: `@template/core` cannot be required under this suite.
    // The module imports nothing, so it loads here as plain data.
    const core = jest.requireActual<{
      readonly CLIENT_ADDRESS_HEADERS: readonly string[];
    }>("../../../../packages/core/src/auth/auth-rate-limit");

    expect(CLIENT_ADDRESS_HEADERS).toEqual(core.CLIENT_ADDRESS_HEADERS);
  });
});
