import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ClaimFormState } from "../components/claim-action";
import en from "../../../../packages/shared/messages/en.json";

/**
 * The home page is the composition point for the builder: it supplies the
 * availability and claim server actions, and the builder does the rest. Both
 * actions are mocked because they reach `lib/services.ts` and so
 * `@template/core`, which cannot be `require`d under this suite.
 */
const checkAvailability = jest.fn((_segment: string) =>
  Promise.resolve("available" as const),
);
jest.mock("../components/availability-action", () => ({
  checkAvailability: (segment: string) => checkAvailability(segment),
}));

const claimFormAction = jest.fn(
  (_previous: ClaimFormState, _formData: FormData) =>
    new Promise<ClaimFormState>(() => undefined),
);
jest.mock("../components/claim-action", () => ({
  claimFormAction: (previous: ClaimFormState, formData: FormData) =>
    claimFormAction(previous, formData),
}));

// The page's metadata reads the origin through `lib/share-link.ts`, which
// imports `@template/core`; the home page uses none of it.
jest.mock("@template/core", () => ({ canonicalAliasOf: () => undefined }));

import Home, { generateMetadata } from "./page";

describe("claiming from the home page", () => {
  it("offers the claim once three picked emoji are available", async () => {
    // #115: a visitor who has picked three emoji can claim them from here, not
    // only from the Handle's own URL.
    const user = userEvent.setup();
    render(<Home />);

    for (let picked = 0; picked < 3; picked += 1) {
      await user.click(screen.getByRole("button", { name: "ice cube" }));
    }

    expect(
      await screen.findByRole("form", { name: en.Claim.claimHeading }),
    ).toBeInTheDocument();
  });
});

describe("Home", () => {
  it("renders the product name as the page heading", () => {
    render(<Home />);

    expect(
      screen.getByRole("heading", { level: 1, name: en.Home.heading }),
    ).toBeInTheDocument();
  });

  it("keeps the line that says what the product is", () => {
    render(<Home />);

    expect(screen.getByText(en.Home.tagline)).toBeInTheDocument();
  });

  it("mounts the builder with its three slots", () => {
    render(<Home />);

    expect(
      screen.getByRole("group", { name: en.HandleBuilder.slotsLabel }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: en.HandleBuilder.slotEmpty.replace("{position}", "1"),
      }),
    ).toBeInTheDocument();
  });

  it("offers a lookup for a Handle somebody heard (#200)", () => {
    render(<Home />);

    const lookup = screen.getByRole("search", {
      name: en.HandleLookup.heading,
    });
    expect(lookup).toHaveAttribute("action", "/find");
    expect(lookup).toHaveAttribute("method", "get");
  });

  it("mentions no OKR concepts", () => {
    const { container } = render(<Home />);

    expect(container.textContent).not.toMatch(/okr|objective|key result/i);
  });

  it("links nowhere, because the routes it used to offer are gone", () => {
    render(<Home />);

    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});

describe("the home page's preview metadata (#204)", () => {
  const ORIGIN = "https://3moji.example";
  const savedOrigin = process.env.BETTER_AUTH_URL;
  afterEach(() => {
    if (savedOrigin === undefined) {
      Reflect.deleteProperty(process.env, "BETTER_AUTH_URL");
    } else {
      process.env.BETTER_AUTH_URL = savedOrigin;
    }
  });

  it("resolves against the configured site origin", () => {
    process.env.BETTER_AUTH_URL = `${ORIGIN}/api/auth`;

    expect(generateMetadata().metadataBase).toEqual(new URL(ORIGIN));
  });

  it("unfurls with the site's name, tagline and the generic image at /og-image", () => {
    process.env.BETTER_AUTH_URL = ORIGIN;

    const metadata = generateMetadata();

    expect(metadata.openGraph).toMatchObject({
      siteName: en.OpenGraph.siteName,
      title: en.OpenGraph.genericTitle,
      description: en.OpenGraph.genericDescription,
      images: [
        {
          url: `${ORIGIN}/og-image`,
          width: 1200,
          height: 630,
          alt: en.OpenGraph.genericImageAlt,
        },
      ],
    });
    expect(metadata.twitter).toMatchObject({
      card: "summary_large_image",
      title: en.OpenGraph.genericTitle,
      images: [`${ORIGIN}/og-image`],
    });
  });

  it("emits no base and no absolute URL when no origin is configured", () => {
    Reflect.deleteProperty(process.env, "BETTER_AUTH_URL");

    const metadata = generateMetadata();

    expect(metadata).not.toHaveProperty("metadataBase");
    expect(metadata.openGraph?.title).toBe(en.OpenGraph.genericTitle);
    expect(JSON.stringify(metadata)).not.toMatch(/https?:|localhost/);
  });
});
