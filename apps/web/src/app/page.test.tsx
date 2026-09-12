import { render, screen } from "@testing-library/react";
import Home from "./page";

describe("Home", () => {
  it("renders the product name as the page heading", () => {
    render(<Home />);
    expect(
      screen.getByRole("heading", { level: 1, name: "3moji" }),
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
