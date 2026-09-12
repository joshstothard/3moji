import { postgresErrorCode, UNIQUE_VIOLATION } from "./postgres-error";

describe("postgresErrorCode", () => {
  it("reads the code a raw driver error carries directly", () => {
    expect(postgresErrorCode({ code: "23505" })).toBe(UNIQUE_VIOLATION);
  });

  /**
   * The failure this function exists for. Drizzle wraps the driver's error, so
   * the top level has no `code` of its own and the real one is in `cause` — and
   * a reader that stops at the top level finds nothing, silently turning "the
   * primary key rejected this" into "something went wrong".
   */
  it("walks the cause chain Drizzle's wrapper puts the driver error behind", () => {
    const wrapped = new Error("Failed query", {
      cause: Object.assign(new Error("duplicate key value"), {
        code: "23505",
      }),
    });

    expect(postgresErrorCode(wrapped)).toBe(UNIQUE_VIOLATION);
  });

  it("walks more than one level, because nesting depth is not our contract", () => {
    expect(postgresErrorCode({ cause: { cause: { code: "23514" } } })).toBe(
      "23514",
    );
  });

  it.each([
    { name: "an error with no code anywhere", error: new Error("boom") },
    { name: "a string", error: "23505" },
    { name: "null", error: null },
    { name: "undefined", error: undefined },
    { name: "a numeric code, which SQLSTATE never is", error: { code: 23505 } },
  ])("reports no code for $name", ({ error }) => {
    expect(postgresErrorCode(error)).toBeUndefined();
  });

  it("names unique_violation, the code that decides a race between claims", () => {
    expect(UNIQUE_VIOLATION).toBe("23505");
  });
});
