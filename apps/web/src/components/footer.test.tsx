import { render, screen } from "@testing-library/react";
import { Footer } from "./footer";

describe("Footer", () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_APP_VERSION;
  });

  it("renders the UI version", () => {
    process.env.NEXT_PUBLIC_APP_VERSION = "9.9.9";
    render(<Footer />);
    expect(screen.getByText(/UI: v9\.9\.9/)).toBeInTheDocument();
  });

  it("falls back to 0.0.0 when the version is unset", () => {
    render(<Footer />);
    expect(screen.getByText(/UI: v0\.0\.0/)).toBeInTheDocument();
  });

  it("shows no API version, because there is no API", () => {
    process.env.NEXT_PUBLIC_APP_VERSION = "9.9.9";
    const { container } = render(<Footer />);
    expect(container.textContent).not.toMatch(/API/i);
  });
});
