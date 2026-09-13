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

import Home from "./page";

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

  it("mentions no OKR concepts", () => {
    const { container } = render(<Home />);

    expect(container.textContent).not.toMatch(/okr|objective|key result/i);
  });

  it("links nowhere, because the routes it used to offer are gone", () => {
    render(<Home />);

    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});
