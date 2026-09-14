import { render, screen, within } from "@testing-library/react";

import * as privacyModule from "./page";
import en from "../../../../../packages/shared/messages/en.json";

const PrivacyPage = privacyModule.default;

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

/**
 * `next/headers` is mocked only so the suite can assert it is never called:
 * the contact address comes from configuration, not from the request (#242).
 */
const headers = jest.fn(() => {
  throw new Error("The privacy notice read request headers.");
});
const cookies = jest.fn(() => {
  throw new Error("The privacy notice read cookies.");
});
jest.mock("next/headers", () => ({
  headers: () => headers(),
  cookies: () => cookies(),
}));

const ADDRESS = "privacy@example.com";
const savedAddress = process.env.REPORT_CONTACT_EMAIL;

function setAddress(value: string | undefined): void {
  if (value === undefined)
    Reflect.deleteProperty(process.env, "REPORT_CONTACT_EMAIL");
  else process.env.REPORT_CONTACT_EMAIL = value;
}

beforeEach(() => {
  setAddress(ADDRESS);
});

afterAll(() => {
  setAddress(savedAddress);
});

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
    expect(
      within(deleting).getByRole("link", { name: ADDRESS }),
    ).toHaveAttribute("href", `mailto:${ADDRESS}`);
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

  it("names Joshua Stothard as the operator and controller", () => {
    render(<PrivacyPage />);

    const whoWeAre = sectionNamed(sections.whoWeAre.heading);
    expect(whoWeAre).toHaveTextContent(/run by Joshua Stothard/);
    expect(whoWeAre).toHaveTextContent(/controller/);
    expect(document.body.textContent).not.toMatch(/Operator name/);
    expect(document.body.textContent).not.toMatch(/\{operator\}|\{contact\}/);
  });

  it("gives a lawful basis for each purpose", () => {
    render(<PrivacyPage />);
    const bases = within(sectionNamed(sections.lawfulBasis.heading))
      .getAllByRole("listitem")
      .map((item) => item.textContent);

    const expectations: readonly (readonly [RegExp, RegExp])[] = [
      [/account, Handle and Profile/, /contract/],
      [/sessions, rate-limit counters and logs/, /legitimate interests/],
      [/page-view analytics/, /legitimate interests/],
    ];
    for (const [purpose, basis] of expectations) {
      const item = bases.find((text) => purpose.test(text));
      expect(item).toMatch(basis);
    }
  });

  it("says when it was last updated", () => {
    render(<PrivacyPage />);

    expect(sectionNamed(sections.changes.heading)).toHaveTextContent(
      /Last updated: 14 September 2026/,
    );
  });

  it("links to the terms of use", () => {
    render(<PrivacyPage />);

    expect(
      screen.getByRole("link", { name: copy.relatedLink }),
    ).toHaveAttribute("href", "/terms");
  });
  it("says how long each provider keeps logs and history, from the providers' own docs", () => {
    // Sources (#242): vercel.com/docs/logs/runtime (Hobby: 1 hour of logs),
    // vercel.com/docs/analytics/limits-and-pricing (1 month reporting window),
    // neon.com/docs/introduction/restore-window (Free: 6 hours), and
    // resend.com/docs/knowledge-base/account-quotas-and-limits (30 days).
    render(<PrivacyPage />);
    const logs = sectionNamed(sections.logsAndBackups.heading);
    const items = within(logs)
      .getAllByRole("listitem")
      .map((item) => item.textContent);

    const expectations: readonly (readonly [RegExp, RegExp])[] = [
      [/^Vercel/, /runtime logs for 1 hour/],
      [/^Vercel/, /analytics for at least a month/],
      [/^Neon/, /6 hours/],
      [/^Resend/, /30 days/],
    ];
    for (const [provider, retention] of expectations) {
      const item = items.find(
        (text) => provider.test(text) && retention.test(text),
      );
      expect(item).toBeDefined();
    }
    expect(logs).not.toHaveTextContent(/How long each provider/);
  });

  it("says where the providers process data, and the UK transfer safeguard", () => {
    // Sources (#242): vercel.com/legal/dpa, resend.com/docs/dashboard/domains/regions,
    // neon.com/docs/introduction/regions and dataprivacyframework.gov/list.
    render(<PrivacyPage />);
    const processors = sectionNamed(sections.processors.heading);

    expect(processors).not.toHaveTextContent(/Where each provider processes/);
    expect(processors).toHaveTextContent(
      /Vercel's main processing facilities are in the United States/,
    );
    expect(processors).toHaveTextContent(
      /Resend stores .* in the United States/,
    );
    expect(processors).toHaveTextContent(
      /UK Extension to the EU-US Data Privacy Framework/,
    );
    expect(processors).toHaveTextContent(
      /under which Vercel and Resend are certified/,
    );
    // Neon, LLC is named in Databricks' DPF notice, but whether that is what
    // covers a Neon Free account was not verified, so the owner confirms it.
    expect(processors).toHaveTextContent(
      /The safeguard for transfers to Neon .* the owner/,
    );
    // Neon's region is chosen when the project is created, so only the owner
    // can say which one it is.
    expect(processors).toHaveTextContent(/Which Neon region .* the owner/);
  });

  describe("the contact address", () => {
    it("links every mention to REPORT_CONTACT_EMAIL as a mailto link", () => {
      render(<PrivacyPage />);

      for (const section of [
        sections.whoWeAre,
        sections.deletingYourData,
        sections.yourRights,
      ]) {
        expect(
          within(sectionNamed(section.heading)).getByRole("link", {
            name: ADDRESS,
          }),
        ).toHaveAttribute("href", `mailto:${ADDRESS}`);
      }
      expect(screen.queryByText(legal.contactPlaceholder)).toBeNull();
    });

    it("reads the address on every render, not once", () => {
      const first = render(<PrivacyPage />);
      first.unmount();
      setAddress("someone-else@example.com");

      render(<PrivacyPage />);

      expect(
        within(sectionNamed(sections.whoWeAre.heading)).getByRole("link", {
          name: "someone-else@example.com",
        }),
      ).toHaveAttribute("href", "mailto:someone-else@example.com");
    });

    it.each([
      ["unset", undefined],
      ["empty", ""],
      ["refused", `${ADDRESS}?bcc=attacker@example.net`],
    ])(
      "keeps the bracketed placeholder, with no link, when the address is %s",
      (_case, value) => {
        setAddress(value);
        render(<PrivacyPage />);

        const whoWeAre = sectionNamed(sections.whoWeAre.heading);
        expect(whoWeAre).toHaveTextContent(legal.contactPlaceholder);
        expect(within(whoWeAre).queryByRole("link")).toBeNull();
        expect(document.body.innerHTML).not.toMatch(/mailto:/);
      },
    );

    it("never reads request headers or cookies", () => {
      render(<PrivacyPage />);

      expect(headers).not.toHaveBeenCalled();
      expect(cookies).not.toHaveBeenCalled();
    });

    it("is rendered per request, so a changed address needs no rebuild", () => {
      const dynamic: unknown = Reflect.get(privacyModule, "dynamic");

      expect(dynamic).toBe("force-dynamic");
    });
  });
});
