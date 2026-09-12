import {
  HOLD_REASONS,
  holdReasonFrom,
  resendNoticeFrom,
  retrySecondsFrom,
} from "./claim-state";

describe("holdReasonFrom", () => {
  it.each(HOLD_REASONS)("accepts the known reason %s", (reason) => {
    expect(holdReasonFrom(reason)).toBe(reason);
  });

  it("falls back to pending for anything it does not recognise", () => {
    // A query string is public input. Trusting it would let a crafted URL tell
    // somebody "that hold has run out" about a perfectly healthy hold.
    expect(holdReasonFrom("hold-expired-lol")).toBe("pending");
    expect(holdReasonFrom("<script>alert(1)</script>")).toBe("pending");
    expect(holdReasonFrom(undefined)).toBe("pending");
    expect(holdReasonFrom("")).toBe("pending");
  });

  it("reads the first value when the parameter is repeated", () => {
    // `?reason=a&reason=b` arrives as an array, and a page that assumed a
    // string would render `undefined` into its own copy.
    expect(holdReasonFrom(["link-expired", "hold-expired"])).toBe(
      "link-expired",
    );
    expect(holdReasonFrom([])).toBe("pending");
  });
});

describe("resendNoticeFrom", () => {
  it("accepts the five notices the action can produce", () => {
    expect(resendNoticeFrom("sent")).toBe("sent");
    expect(resendNoticeFrom("too-soon")).toBe("too-soon");
    expect(resendNoticeFrom("too-many")).toBe("too-many");
    expect(resendNoticeFrom("invalid")).toBe("invalid");
    expect(resendNoticeFrom("failed")).toBe("failed");
  });

  it("treats anything else as nothing having happened", () => {
    expect(resendNoticeFrom("sent!")).toBeUndefined();
    expect(resendNoticeFrom(undefined)).toBeUndefined();
  });
});

describe("retrySecondsFrom", () => {
  it("accepts whole seconds", () => {
    expect(retrySecondsFrom("45")).toBe(45);
    expect(retrySecondsFrom(["600"])).toBe(600);
  });

  it("refuses anything that would land in copy as nonsense", () => {
    // It is interpolated into a sentence a person reads, so "try again in NaN
    // seconds" and "try again in -4 seconds" must both become no hint at all.
    expect(retrySecondsFrom("soon")).toBeUndefined();
    expect(retrySecondsFrom("-4")).toBeUndefined();
    expect(retrySecondsFrom("0")).toBeUndefined();
    expect(retrySecondsFrom("4.5")).toBeUndefined();
    expect(retrySecondsFrom("999999999")).toBeUndefined();
    expect(retrySecondsFrom(undefined)).toBeUndefined();
  });
});
