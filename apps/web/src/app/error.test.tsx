import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ErrorPage from "./error";
import { checkAccessibility } from "../test-support/axe";
import { THROWN_DETAILS, thrownError } from "../test-support/thrown-error";
import en from "../../../../packages/shared/messages/en.json";

/**
 * The branded error page ([#203](https://github.com/joshstothard/3moji/issues/203)).
 *
 * Next.js renders it, in the browser, when a segment below the root layout
 * throws. In development the `error` it receives still carries the original
 * message, and in production it carries a digest; the page shows neither, nor
 * the stack. It logs nothing in the browser either: a failure belongs in the
 * server's logs, and `lib/request-error.ts` holds what the server will do with
 * it once #148 unblocks the hook.
 */
const copy = en.ErrorPage;

describe("the error page", () => {
  it("says something went wrong, as the page's one heading", () => {
    render(<ErrorPage error={thrownError()} retry={jest.fn()} />);

    expect(
      screen.getByRole("heading", { level: 1, name: copy.heading }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("heading")).toHaveLength(1);
    expect(screen.getByText(copy.body)).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
  });

  it("offers a retry that asks Next.js to render the segment again", async () => {
    const user = userEvent.setup();
    const retry = jest.fn();
    render(<ErrorPage error={thrownError()} retry={retry} />);

    await user.click(screen.getByRole("button", { name: copy.retry }));

    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("links home", () => {
    render(<ErrorPage error={thrownError()} retry={jest.fn()} />);

    expect(screen.getByRole("link", { name: copy.home })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it.each(THROWN_DETAILS)("never shows %p", (detail) => {
    const { container } = render(
      <ErrorPage error={thrownError()} retry={jest.fn()} />,
    );

    expect(container.innerHTML).not.toContain(detail);
  });

  it("logs nothing in the browser", () => {
    const spies = (["error", "warn", "log", "info"] as const).map((method) =>
      jest.spyOn(console, method).mockImplementation(() => undefined),
    );
    try {
      render(<ErrorPage error={thrownError()} retry={jest.fn()} />);

      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it("has no WCAG A or AA violations", async () => {
    const { container } = render(
      <ErrorPage error={thrownError()} retry={jest.fn()} />,
    );

    const report = await checkAccessibility(container);

    expect(report.violations).toEqual([]);
    expect(report.incomplete).toEqual([]);
    expect(report.passed).toEqual(
      expect.arrayContaining(["button-name", "link-name"]),
    );
  });
});
