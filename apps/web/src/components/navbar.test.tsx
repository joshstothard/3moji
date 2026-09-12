import { render, screen } from "@testing-library/react";
import { Navbar } from "./navbar";

describe("Navbar", () => {
  it("renders the product name linking home", () => {
    render(<Navbar />);
    expect(screen.getByRole("link", { name: "3moji" })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("offers no links to the removed OKR sections", () => {
    render(<Navbar />);
    const hrefs = screen
      .queryAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(hrefs).not.toContain("/objectives");
    expect(hrefs).not.toContain("/dashboard");
  });

  it("mentions no OKR concepts", () => {
    const { container } = render(<Navbar />);
    expect(container.textContent).not.toMatch(/okr|objective|dashboard/i);
  });
});
