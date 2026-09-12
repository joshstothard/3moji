import { render, screen } from "@testing-library/react";

import { HOLD_REASONS, type HoldReason } from "./claim-state";
import { HoldScreen } from "./hold-screen";

const ICE = "\u{1F9CA}\u{1F9CA}\u{1F9CA}";
const ENCODED = "%F0%9F%A7%8A%F0%9F%A7%8A%F0%9F%A7%8A";

const renderScreen = (
  reason: HoldReason,
  extra: Partial<Parameters<typeof HoldScreen>[0]> = {},
) =>
  render(
    <HoldScreen
      encoded={ENCODED}
      handleKey={ICE}
      reason={reason}
      resend={() => undefined}
      {...extra}
    />,
  );

describe("HoldScreen", () => {
  describe("what it says about the Handle", () => {
    it("shows the Handle, its spoken form, and the 24 hours", () => {
      // #82: the hold screen shows the Handle, its spoken form, and states
      // plainly that it is held for 24 hours.
      renderScreen("pending");

      expect(
        screen.getByRole("img", { name: "three ice cubes" }),
      ).toHaveTextContent(ICE);
      expect(screen.getByText(/say it: three ice cubes/i)).toBeInTheDocument();
      expect(
        screen.getByText(/held for you for 24 hours/i),
      ).toBeInTheDocument();
    });

    it.each([
      "pending",
      "link-expired",
      "link-superseded",
      "unverified",
    ] as const)(
      "never implies the Handle was lost when the hold is alive: %s",
      (reason) => {
        // The acceptance criterion this component exists for. All four of these
        // states have a live Hold, and the screen has to say so.
        renderScreen(reason);

        expect(
          screen.getByText(/held for you for 24 hours/i),
        ).toBeInTheDocument();
        expect(screen.queryByText(/gone back into the pool/i)).toBeNull();
      },
    );

    it("says the link expired and offers a new one, without blaming the Handle", () => {
      renderScreen("link-expired");

      expect(
        screen.getByRole("heading", {
          level: 1,
          name: /that link has expired/i,
        }),
      ).toBeInTheDocument();
      expect(screen.getByText(/still held for you/i)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /send a new link/i }),
      ).toBeInTheDocument();
    });

    it("explains that only the newest link works when an older one was used", () => {
      renderScreen("link-superseded");

      expect(
        screen.getByRole("heading", {
          level: 1,
          name: /that link has been replaced/i,
        }),
      ).toBeInTheDocument();
      expect(screen.getByText(/only the newest one does/i)).toBeInTheDocument();
    });

    it("renders the 403 before verification as a hold screen, not an error", () => {
      // Better Auth answers sign-in on an unverified Account with 403. It must
      // not surface as a failure: nothing went wrong.
      renderScreen("unverified");

      expect(screen.queryByRole("alert")).toBeNull();
      expect(
        screen.getByRole("heading", { level: 1, name: /confirm your email/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /send a new link/i }),
      ).toBeInTheDocument();
    });

    it("is honest when the hold really has run out, and offers no resend", () => {
      // The one state where the Handle *is* gone. Offering a new link here
      // would send somebody to confirm an email for a Handle they cannot have.
      renderScreen("hold-expired");

      expect(screen.getByText(/gone back into the pool/i)).toBeInTheDocument();
      expect(screen.queryByText(/held for you for 24 hours/i)).toBeNull();
      expect(
        screen.queryByRole("button", { name: /send a new link/i }),
      ).toBeNull();
      expect(
        screen.getByRole("link", { name: /pick a handle/i }),
      ).toHaveAttribute("href", "/");
    });

    it("names no Handle when it does not know which one", () => {
      render(<HoldScreen reason="link-unknown" resend={() => undefined} />);

      expect(screen.queryByRole("img")).toBeNull();
      expect(screen.queryByText(/say it:/i)).toBeNull();
      // A new link is still worth offering: they know their own address.
      expect(
        screen.getByRole("button", { name: /send a new link/i }),
      ).toBeInTheDocument();
    });
  });

  describe("the resend form", () => {
    it("is a labelled email field with a submit button", () => {
      // WCAG AA: an accessible name, and a control a keyboard can reach. The
      // label is associated by `htmlFor`, which is what `getByLabelText` proves.
      renderScreen("pending");

      const field = screen.getByLabelText(
        /the email address you signed up with/i,
      );
      expect(field).toHaveAttribute("type", "email");
      expect(field).toBeRequired();
      expect(field).toHaveAttribute("autocomplete", "email");
      expect(
        screen.getByRole("button", { name: /send a new link/i }),
      ).toHaveAttribute("type", "submit");
    });

    it("is the obvious action, with its own heading", () => {
      // #82: "Resend is the obvious action on that screen, not an afterthought."
      renderScreen("pending");

      expect(
        screen.getByRole("heading", { level: 2, name: /send me a new link/i }),
      ).toBeInTheDocument();
    });

    it("carries the Handle and the reason back, so the answer lands here", () => {
      const { container } = renderScreen("link-expired");

      expect(container.querySelector('input[name="handle"]')).toHaveAttribute(
        "value",
        ENCODED,
      );
      expect(container.querySelector('input[name="reason"]')).toHaveAttribute(
        "value",
        "link-expired",
      );
    });

    it("carries no handle field when there is no Handle to name", () => {
      const { container } = render(
        <HoldScreen reason="link-unknown" resend={() => undefined} />,
      );

      expect(container.querySelector('input[name="handle"]')).toBeNull();
    });

    it("announces the answer in a live region", () => {
      // The answer arrives as a fresh render rather than as client state, so a
      // sighted user sees it appear while a screen-reader user would otherwise
      // be told nothing.
      renderScreen("pending", { notice: "sent" });

      expect(screen.getByRole("status")).toHaveTextContent(
        /a new link is on its way/i,
      );
    });

    it("says how long to wait when the minute limit refused", () => {
      renderScreen("pending", { notice: "too-soon", retrySeconds: 45 });

      expect(screen.getByRole("status")).toHaveTextContent(
        /try again in 45 seconds/i,
      );
    });

    it("rounds the hour limit up, because 'in 0 minutes' is not an instruction", () => {
      renderScreen("pending", { notice: "too-many", retrySeconds: 20 });

      expect(screen.getByRole("status")).toHaveTextContent(
        /try again in 1 minutes/i,
      );
    });

    it("reports minutes for a long wait", () => {
      renderScreen("pending", { notice: "too-many", retrySeconds: 600 });

      expect(screen.getByRole("status")).toHaveTextContent(
        /try again in 10 minutes/i,
      );
    });

    it("asks for the address again when the form was empty", () => {
      renderScreen("pending", { notice: "invalid" });

      expect(screen.getByRole("status")).toHaveTextContent(
        /enter the email address/i,
      );
    });

    it("does not claim a link is coming when the send failed", () => {
      // Telling somebody a link is on its way when none is leaves them waiting
      // for an email that never arrives.
      renderScreen("pending", { notice: "failed" });

      expect(screen.getByRole("status")).toHaveTextContent(
        /could not send a link/i,
      );
    });

    it("leaves the live region empty before the form has run", () => {
      renderScreen("pending");

      expect(screen.getByRole("status")).toHaveTextContent("");
    });
  });

  it("has exactly one level-one heading in every state", () => {
    // WCAG: one page title. A `Record` over the union is what stops a seventh
    // state shipping with none.
    for (const reason of HOLD_REASONS) {
      const { unmount } = renderScreen(reason);
      expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
      unmount();
    }
  });
});
