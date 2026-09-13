import type { Profile } from "../ports/profile-repository";

import { profileStateOf } from "./profile-state";

const EDITED: Profile = {
  displayName: "Someone",
  bio: null,
  links: [],
  updatedAt: new Date("2026-09-12T12:00:00.000Z"),
};

describe("profileStateOf", () => {
  it("shows the Profile of a claimed Handle that has one", () => {
    expect(profileStateOf("claimed", EDITED)).toEqual({
      state: "profile",
      profile: EDITED,
    });
  });

  it("names 'claimed but unedited' rather than an empty Profile", () => {
    // The acceptance criterion this exists for: a caller must be able to *see*
    // that the owner has never edited anything, not infer it from a Profile
    // whose every field happens to be null.
    expect(profileStateOf("claimed", undefined)).toEqual({
      state: "unedited",
    });
  });

  it("has no Profile to show for an available Handle", () => {
    expect(profileStateOf("available", undefined)).toEqual({ state: "none" });
  });

  it("has no Profile to show for a held Handle", () => {
    expect(profileStateOf("held", undefined)).toEqual({ state: "none" });
  });

  it("withholds a Profile from a Handle that is only held", () => {
    // ADR-0004: a held Handle reveals neither who holds it nor when the hold
    // expires. A Profile row written before the Claim was finalised must not
    // leak through this function, so `held` wins over the row's existence.
    expect(profileStateOf("held", EDITED)).toEqual({ state: "none" });
  });

  it("withholds a Profile from an available Handle", () => {
    // The same argument at the other end: an expired hold reads as `available`
    // while its row is still sitting there, and its Profile row may still be
    // sitting there too.
    expect(profileStateOf("available", EDITED)).toEqual({ state: "none" });
  });
});
