import { renderToStaticMarkup } from "react-dom/server";

// next/font/google runs a build-time font loader that cannot execute under Jest.
jest.mock("next/font/google", () => ({
  Inter: () => ({ className: "font-inter" }),
}));

import RootLayout, { metadata } from "./layout";

const shell = () =>
  renderToStaticMarkup(
    <RootLayout>
      <p>child content</p>
    </RootLayout>,
  );

describe("RootLayout", () => {
  it("wraps its children in the app shell", () => {
    expect(shell()).toContain("child content");
  });

  it("renders the product name from the navbar", () => {
    expect(shell()).toContain("3moji");
  });

  it("titles the document with the product name", () => {
    expect(metadata.title).toBe("3moji");
  });

  it("carries no OKR branding in its metadata", () => {
    expect(JSON.stringify(metadata)).not.toMatch(/okr|objective|key result/i);
  });
});
