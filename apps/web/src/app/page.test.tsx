import { render, screen } from "@testing-library/react";
import en from "../../../../packages/shared/messages/en.json";

/**
 * The home page is the composition point for the builder: it supplies the
 * availability server action, and the builder does the rest. The action is
 * mocked because it reaches `lib/services.ts` and so `@template/core`, which
 * cannot be `require`d under this suite.
 */
const checkAvailability = jest.fn((_segment: string) =>
  Promise.resolve("available" as const),
);
jest.mock("../components/availability-action", () => ({
  checkAvailability: (segment: string) => checkAvailability(segment),
}));

import Home from "./page";

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
