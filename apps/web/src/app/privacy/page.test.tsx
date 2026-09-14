import { render, screen, within } from "@testing-library/react";

import PrivacyPage from "./page";
import en from "../../../../../packages/shared/messages/en.json";

/**
 * The privacy notice ([#196](https://github.com/joshstothard/3moji/issues/196)).
 *
 * The assertions come from the issue's acceptance criteria and from the data
 * `docs/architecture/data-model.md` and `auth.md` say is stored, not from the
 * copy restated: each checks that a required fact is on the page, in the
 * section a reader would look for it in.
 */
const legal = en.Legal;
const copy = legal.Privacy;
const sections = copy.sections;

function sectionNamed(heading: string): HTMLElement {
  return screen.getByRole("region", { name: heading });
}

describe("the privacy notice", () => {
  it("is headed as the privacy notice", () => {
    render(<PrivacyPage />);

    expect(
      screen.getByRole("heading", { level: 1, name: copy.heading }),
    ).toBeInTheDocument();
  });

  it("shows the draft marker until the owner removes it", () => {
    render(<PrivacyPage />);

    expect(screen.getByText(legal.draftMarker)).toBeVisible();
    expect(legal.draftMarker).toBe("Draft — pending owner review");
  });

  it.each(Object.values(sections).map((section) => section.heading))(
    "has a section headed %s",
    (heading) => {
      render(<PrivacyPage />);

      expect(sectionNamed(heading)).toBeInTheDocument();
    },
  );

  it("lists every kind of data the service stores, with how long each is kept", () => {
    render(<PrivacyPage />);
    const items = within(sectionNamed(sections.whatWeStore.heading))
      .getAllByRole("listitem")
      .map((item) => item.textContent);

    const expectations: readonly (readonly [RegExp, RegExp])[] = [
      [/^Your email address/, /until your account is deleted/],
      [/password, as a hash/, /until your account is deleted/],
      [/^Your Handle/, /until your account is deleted/],
      [/display name, bio and Links/, /until you change it/],
      [/IP address.*user agent/, /7 days/],
      [/fingerprint of the link/, /until your account is deleted/],
      [/^Password reset tokens/, /1 hour/],
      [/keyed hash/, /an hour/],
      [/^Released Handles/, /indefinitely/],
    ];
    for (const [subject, retention] of expectations) {
      const item = items.find((text) => subject.test(text));
      expect(item).toMatch(retention);
    }
  });

  it("says every rate-limit counter holds a keyed hash, never the IP address itself", () => {
    // Since #214 Better Auth's own counters (`auth_rate_limit.key`) are hashed
    // like `claim_rate_limit`'s, under a key derived from the auth secret
    // (auth.md). Until then this notice said they held the address as it is.
    render(<PrivacyPage />);
    const counters = within(sectionNamed(sections.whatWeStore.heading))
      .getAllByRole("listitem")
      .map((item) => item.textContent)
      .find((text) => text.startsWith("Rate-limit counters"));

    expect(counters).toMatch(/Every counter holds a keyed hash/);
    expect(counters).not.toMatch(/as it is|unhashed|in clear/);
  });

  it("says an unverified account can outlive its 24-hour hold", () => {
    // Hold expiry is lazy (ADR-0004 decision 3): nothing sweeps it.
    render(<PrivacyPage />);

    const unverified = sectionNamed(sections.unverified.heading);
    expect(unverified).toHaveTextContent(/24 hours/);
    expect(unverified).toHaveTextContent(/next time anyone tries to claim/);
  });

  it("names the processors", () => {
    render(<PrivacyPage />);

    const processors = sectionNamed(sections.processors.heading);
    for (const name of ["Vercel", "Neon", "Resend"]) {
      expect(processors).toHaveTextContent(name);
    }
  });

  it("says Vercel also records cookieless page-view analytics, and what it records", () => {
    // Vercel Web Analytics was added at the owner's request on 2026-09-14.
    // What it records, and how a visit is identified, is taken from Vercel's
    // own docs (vercel.com/docs/analytics and /docs/analytics/privacy-policy),
    // not from the copy restated.
    render(<PrivacyPage />);
    const vercel = within(sectionNamed(sections.processors.heading))
      .getAllByRole("listitem")
      .map((item) => item.textContent)
      .find((text) => text.startsWith("Vercel"));

    expect(vercel).toMatch(/page-view analytics/);
    expect(vercel).toMatch(/does not use cookies/);
    for (const recorded of [
      /page you visit/,
      /referr/,
      /browser/,
      /operating system/,
      /type of device/,
      /approximate location/,
    ]) {
      expect(vercel).toMatch(recorded);
    }
    expect(vercel).toMatch(/hash of your request/);
    expect(vercel).toMatch(/resets every day/);
    expect(vercel).toMatch(/not tied to you or to your IP address/);
  });

  it("explains what deleting an account removes, and how to ask for it", () => {
    render(<PrivacyPage />);

    const deleting = sectionNamed(sections.deletingYourData.heading);
    expect(deleting).toHaveTextContent(
      /email address, password hash, sessions, verification records, Profile and Links/,
    );
    expect(deleting).toHaveTextContent(legal.contactPlaceholder);
  });

  it("lists UK GDPR rights and where to complain", () => {
    render(<PrivacyPage />);

    const rights = sectionNamed(sections.yourRights.heading);
    expect(
      within(rights).getAllByRole("listitem").length,
    ).toBeGreaterThanOrEqual(5);
    expect(rights).toHaveTextContent(/delete your data/);
    expect(rights).toHaveTextContent(/ICO/);
  });

  it("identifies the operator only by a marked placeholder", () => {
    render(<PrivacyPage />);

    expect(sectionNamed(sections.whoWeAre.heading)).toHaveTextContent(
      legal.operatorPlaceholder,
    );
    expect(document.body.textContent).not.toMatch(/\{operator\}|\{contact\}/);
  });

  it("links to the terms of use", () => {
    render(<PrivacyPage />);

    expect(
      screen.getByRole("link", { name: copy.relatedLink }),
    ).toHaveAttribute("href", "/terms");
  });
});
