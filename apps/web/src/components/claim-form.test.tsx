import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ClaimFormState } from "./claim-action";
import { ClaimForm } from "./claim-form";
import en from "../../../../packages/shared/messages/en.json";

/**
 * The claim form, driven through the interface
 * ([#115](https://github.com/joshstothard/3moji/issues/115)).
 *
 * The one collaborator faked is the claim itself: it is a server action, and
 * the form takes it as a prop for exactly that reason
 * (`docs/development/engineering-standards.md` § The composition root). Whether
 * an already-registered address is indistinguishable from a new one is proved
 * against the real action and the real domain in
 * `claim-non-enumeration.test.tsx`; this suite is about what the form does with
 * each answer it can be given.
 */
const copy = en.Claim;
const ENCODED = "%F0%9F%A7%8A%F0%9F%A7%8A%F0%9F%A7%8A";
const EMAIL = "claimant@example.com";
const PASSWORD = "correct horse battery staple";

type Claim = (
  previous: ClaimFormState,
  formData: FormData,
) => Promise<ClaimFormState>;

function renderForm(claim: Claim) {
  const user = userEvent.setup();
  const view = render(<ClaimForm claim={claim} handle={ENCODED} />);
  return { user, ...view };
}

function answering(
  state: ClaimFormState,
): jest.Mock<Promise<ClaimFormState>, [ClaimFormState, FormData]> {
  return jest.fn((_previous: ClaimFormState, _formData: FormData) =>
    Promise.resolve(state),
  );
}

const emailField = () => screen.getByLabelText(copy.claimEmailLabel);
const passwordField = () => screen.getByLabelText(copy.claimPasswordLabel);
const submitButton = () =>
  screen.getByRole("button", { name: copy.claimSubmit });
const alertRegion = () => screen.getByRole("alert");

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(emailField(), EMAIL);
  await user.type(passwordField(), PASSWORD);
  await user.click(submitButton());
}

describe("the claim form", () => {
  it("is a named form, so it can be found as one", () => {
    renderForm(answering({ state: "idle" }));

    expect(
      screen.getByRole("form", { name: copy.claimHeading }),
    ).toBeInTheDocument();
  });

  it("asks for the email as an email, for autofill", () => {
    renderForm(answering({ state: "idle" }));

    const field = emailField();
    expect(field).toHaveAttribute("type", "email");
    expect(field).toHaveAttribute("autocomplete", "email");
    expect(field).toHaveAttribute("name", "email");
    expect(field).toBeRequired();
  });

  it("links the privacy notice and the terms next to the email field, before the submit button (#198)", () => {
    renderForm(answering({ state: "idle" }));

    const privacy = screen.getByRole("link", { name: copy.claimPrivacyLink });
    const terms = screen.getByRole("link", { name: copy.claimTermsLink });
    expect(privacy).toHaveAttribute("href", "/privacy");
    expect(terms).toHaveAttribute("href", "/terms");

    // Next to the email field: after it, and before the password field and
    // the submit button, in document order and so in reading and tab order.
    const follows = (earlier: Element, later: Element) =>
      (earlier.compareDocumentPosition(later) &
        Node.DOCUMENT_POSITION_FOLLOWING) !==
      0;
    for (const link of [privacy, terms]) {
      expect(follows(emailField(), link)).toBe(true);
      expect(follows(link, passwordField())).toBe(true);
      expect(follows(link, submitButton())).toBe(true);
    }
  });

  it("opens the legal pages in a new tab, so the Handle being claimed is not lost (#198)", () => {
    renderForm(answering({ state: "idle" }));

    for (const name of [copy.claimPrivacyLink, copy.claimTermsLink]) {
      const link = screen.getByRole("link", { name });
      expect(link).toHaveAttribute("target", "_blank");
      expect(link.getAttribute("rel")).toMatch(/\bnoopener\b/);
      // The accessible name says so, rather than surprising anybody.
      expect(name).toMatch(/opens in a new tab/);
    }
    const note = copy.claimLegalNote
      .replace("{privacy}", copy.claimPrivacyLink)
      .replace("{terms}", copy.claimTermsLink);
    expect(
      screen.getByText(
        (_content, element) =>
          element?.tagName === "P" && element.textContent === note,
      ),
    ).toBeInTheDocument();
  });

  it("asks for a new password as a password, never as text", () => {
    renderForm(answering({ state: "idle" }));

    const field = passwordField();
    expect(field).toHaveAttribute("type", "password");
    expect(field).toHaveAttribute("autocomplete", "new-password");
    expect(field).toHaveAttribute("name", "password");
    expect(field).toBeRequired();
  });

  it("posts the Handle it was given, with the email and the password", async () => {
    const claim = answering({ state: "failed" });
    const { user } = renderForm(claim);

    await fillAndSubmit(user);

    await waitFor(() => {
      expect(claim).toHaveBeenCalledTimes(1);
    });
    const posted = claim.mock.calls[0]?.[1];
    expect(posted?.get("handle")).toBe(ENCODED);
    expect(posted?.get("email")).toBe(EMAIL);
    expect(posted?.get("password")).toBe(PASSWORD);
  });

  it("never submits by GET, which would put the password in a URL", () => {
    renderForm(answering({ state: "idle" }));

    const form = screen.getByRole("form", { name: copy.claimHeading });
    expect(form.getAttribute("method")?.toLowerCase()).not.toBe("get");
  });

  it("keeps the password out of the markup while it is being typed", async () => {
    // A controlled password input writes its value into a `value` attribute,
    // which is then in the DOM for anything that serialises it.
    const { user, container } = renderForm(answering({ state: "idle" }));

    await user.type(passwordField(), PASSWORD);

    expect(container.innerHTML).not.toContain(PASSWORD);
  });

  it("has an empty alert region from the first render, so a rejection is announced", () => {
    // A live region inserted at the moment it has something to say is not
    // observed in time to announce it.
    renderForm(answering({ state: "idle" }));

    expect(alertRegion()).toBeEmptyDOMElement();
  });

  it.each([
    [
      "taken because it is held",
      { state: "taken", because: "held" },
      copy.claimTaken,
    ],
    [
      "taken because it is claimed",
      { state: "taken", because: "claimed" },
      copy.claimTaken,
    ],
    [
      "taken by a lost race",
      { state: "taken", because: "write-rejected" },
      copy.claimTaken,
    ],
    ["reserved", { state: "not-claimable" }, copy.claimNotClaimable],
    ["not a Handle", { state: "not-a-handle" }, copy.claimNotAHandle],
    ["missing a field", { state: "invalid" }, copy.claimInvalid],
    ["a failure", { state: "failed" }, copy.claimFailed],
    ["too many attempts", { state: "rate-limited" }, copy.claimRateLimited],
  ] as const)(
    "renders a rejection for %s",
    async (_name, state: ClaimFormState, message) => {
      const { user } = renderForm(answering(state));

      await fillAndSubmit(user);

      await waitFor(() => {
        expect(alertRegion()).toHaveTextContent(message);
      });
    },
  );

  it("does not say whether a taken Handle is held or claimed", async () => {
    // ADR-0004: who holds a Handle, and until when, is not this page's to say.
    const { user } = renderForm(answering({ state: "taken", because: "held" }));

    await fillAndSubmit(user);

    await waitFor(() => {
      expect(alertRegion()).toHaveTextContent(copy.claimTaken);
    });
    expect(alertRegion()).not.toHaveTextContent(/hold|held/i);
  });

  it("marks both fields invalid, describes them by the message, and moves focus to the first", async () => {
    const { user } = renderForm(answering({ state: "invalid" }));

    await fillAndSubmit(user);

    await waitFor(() => {
      expect(emailField()).toHaveAttribute("aria-invalid", "true");
    });
    expect(passwordField()).toHaveAttribute("aria-invalid", "true");
    expect(emailField()).toHaveAccessibleDescription(copy.claimInvalid);
    expect(passwordField()).toHaveAccessibleDescription(copy.claimInvalid);
    expect(emailField()).toHaveFocus();
  });

  it.each([
    { state: "taken", because: "claimed" },
    { state: "not-claimable" },
    { state: "not-a-handle" },
    { state: "failed" },
  ] as const)(
    "blames no field for $state, and describes the submit by the message",
    async (state: ClaimFormState) => {
      // The Handle is at fault, or nothing is: marking the email invalid for
      // "this Handle is taken" would send a screen reader user to fix the wrong
      // thing.
      const { user } = renderForm(answering(state));

      await fillAndSubmit(user);

      await waitFor(() => {
        expect(alertRegion()).not.toBeEmptyDOMElement();
      });
      expect(emailField()).not.toHaveAttribute("aria-invalid", "true");
      expect(passwordField()).not.toHaveAttribute("aria-invalid", "true");
      expect(submitButton()).toHaveAccessibleDescription(
        alertRegion().textContent,
      );
    },
  );

  it("clears the password after a rejection, and keeps the email", async () => {
    const { user, container } = renderForm(answering({ state: "failed" }));

    await fillAndSubmit(user);

    await waitFor(() => {
      expect(alertRegion()).toHaveTextContent(copy.claimFailed);
    });
    expect(passwordField()).toHaveValue("");
    expect(emailField()).toHaveValue(EMAIL);
    expect(container.innerHTML).not.toContain(PASSWORD);
  });

  it("is operable by keyboard alone, in reading order", async () => {
    const claim = answering({ state: "failed" });
    const { user } = renderForm(claim);

    await user.tab();
    expect(emailField()).toHaveFocus();
    await user.keyboard(EMAIL);

    // The privacy notice and the terms are linked beside the email field,
    // before submission (#198), so they are the next two stops.
    await user.tab();
    expect(
      screen.getByRole("link", { name: copy.claimPrivacyLink }),
    ).toHaveFocus();
    await user.tab();
    expect(
      screen.getByRole("link", { name: copy.claimTermsLink }),
    ).toHaveFocus();

    await user.tab();
    expect(passwordField()).toHaveFocus();
    await user.keyboard(PASSWORD);

    await user.tab();
    expect(submitButton()).toHaveFocus();

    await user.keyboard("{Enter}");
    await waitFor(() => {
      expect(claim).toHaveBeenCalledTimes(1);
    });
  });

  it("shows a visible focus ring on every control", () => {
    renderForm(answering({ state: "idle" }));

    for (const control of [emailField(), passwordField(), submitButton()]) {
      expect(control.className).toMatch(/focus-visible:outline-indigo-600/);
    }
  });

  it("renders and announces a rate-limited answer, blaming neither field (#157)", async () => {
    const { user } = renderForm(answering({ state: "rate-limited" }));

    await fillAndSubmit(user);

    await waitFor(() => {
      expect(alertRegion()).toHaveTextContent(copy.claimRateLimited);
    });
    // One sentence whichever limit bound, so it names neither.
    expect(copy.claimRateLimited).not.toMatch(/email|address|network/i);
    expect(emailField()).not.toHaveAttribute("aria-invalid");
    expect(passwordField()).not.toHaveAttribute("aria-invalid");
    expect(submitButton()).toHaveAttribute("aria-describedby", "claim-message");
  });

  it("has no success state of its own: an accepted Claim is a redirect", async () => {
    // The action redirects on success and never returns, so nothing arrives
    // here to render. A form that grew a "check your email" branch would be a
    // second, client-side success — and a second place an already-registered
    // address could be told apart from a new one.
    const claim = jest.fn(
      (_previous: ClaimFormState, _formData: FormData) =>
        new Promise<ClaimFormState>(() => undefined),
    );
    const { user } = renderForm(claim);

    await fillAndSubmit(user);
    await waitFor(() => {
      expect(claim).toHaveBeenCalledTimes(1);
    });

    expect(alertRegion()).toBeEmptyDOMElement();
    expect(emailField()).not.toHaveAttribute("aria-invalid");
    expect(submitButton()).toHaveFocus();
  });
});
