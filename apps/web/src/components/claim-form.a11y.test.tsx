import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ClaimFormState } from "./claim-action";
import { ClaimForm } from "./claim-form";
import { checkAccessibility } from "../test-support/axe";
import en from "../../../../packages/shared/messages/en.json";

/**
 * The claim form idle and after every rejection, checked by axe for WCAG 2 A
 * and AA ([#152](https://github.com/joshstothard/3moji/issues/152)).
 *
 * Rendered and submitted as `claim-form.test.tsx` does: the claim is a server
 * action, faked by the prop the form takes for that reason. A rejection is the
 * state worth checking — it is when fields turn `aria-invalid` and gain an
 * accessible description, which is where a broken reference would show.
 */
const copy = en.Claim;
const ENCODED = "%F0%9F%A7%8A%F0%9F%A7%8A%F0%9F%A7%8A";
const EMAIL = "claimant@example.com";
const PASSWORD = "correct horse battery staple";

function answering(state: ClaimFormState) {
  return jest.fn((_previous: ClaimFormState, _formData: FormData) =>
    Promise.resolve(state),
  );
}

describe("the claim form, checked by axe", () => {
  it("reports no violations while idle", async () => {
    const { container } = render(
      <ClaimForm claim={answering({ state: "idle" })} handle={ENCODED} />,
    );

    const report = await checkAccessibility(container);

    expect(report.violations).toEqual([]);
    expect(report.incomplete).toEqual([]);
    expect(report.passed).toEqual(
      expect.arrayContaining(["label", "button-name", "autocomplete-valid"]),
    );
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
    "reports no violations after a rejection for %s",
    async (_name, state: ClaimFormState, message) => {
      const user = userEvent.setup();
      const { container } = render(
        <ClaimForm claim={answering(state)} handle={ENCODED} />,
      );

      await user.type(screen.getByLabelText(copy.claimEmailLabel), EMAIL);
      await user.type(screen.getByLabelText(copy.claimPasswordLabel), PASSWORD);
      await user.click(screen.getByRole("button", { name: copy.claimSubmit }));
      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent(message);
      });

      const report = await checkAccessibility(container);

      expect(report.violations).toEqual([]);
      expect(report.incomplete).toEqual([]);
      expect(report.passed).toEqual(
        expect.arrayContaining(["label", "aria-valid-attr-value"]),
      );
    },
  );
});
