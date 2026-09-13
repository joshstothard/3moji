import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ProfileDraft, ProfileViolation } from "@template/core";

import { ProfileForm } from "./profile-form";
import type { ProfileEditFormState } from "./profile-edit-state";
import { checkAccessibility } from "../test-support/axe";
import en from "../../../../packages/shared/messages/en.json";

/**
 * The Profile edit form idle and after every refusal, checked by axe for WCAG 2
 * A and AA ([#152](https://github.com/joshstothard/3moji/issues/152)).
 *
 * The draft, the violations and the substituted action are the ones
 * `profile-form.test.tsx` uses. A refused save is the state worth checking:
 * fields turn `aria-invalid` and are described by their messages.
 */
const copy = en.ProfileEdit;
const ENCODED = "%F0%9F%A7%8A%F0%9F%A7%8A%F0%9F%A7%8A";

const draft = (overrides: Partial<ProfileDraft> = {}): ProfileDraft => ({
  displayName: "Ice Cube",
  bio: "Three of them.",
  links: [{ title: "Home", url: "https://example.com" }],
  ...overrides,
});

const tooLongBio: ProfileViolation = {
  field: "bio",
  rule: "too-long",
  limit: 160,
  length: 170,
};

const badUrl: ProfileViolation = {
  field: "link.url",
  index: 0,
  rule: "unsupported-scheme",
  scheme: "javascript:",
};

function renderForm(answer: ProfileEditFormState) {
  const save = (
    _previous: ProfileEditFormState,
    _formData: FormData,
  ): Promise<ProfileEditFormState> => Promise.resolve(answer);
  return render(<ProfileForm handle={ENCODED} initial={draft()} save={save} />);
}

describe("the Profile edit form, checked by axe", () => {
  it("reports no violations while idle", async () => {
    const { container } = renderForm({ state: "idle" });

    const report = await checkAccessibility(container);

    expect(report.violations).toEqual([]);
    expect(report.incomplete).toEqual([]);
    expect(report.passed).toEqual(
      expect.arrayContaining(["label", "button-name", "list", "listitem"]),
    );
  });

  it.each([
    [
      "invalid",
      {
        state: "invalid",
        violations: [tooLongBio, badUrl],
        draft: draft({ bio: "x".repeat(170) }),
      },
      copy.invalidSummary,
    ],
    ["forbidden", { state: "forbidden", draft: draft() }, copy.forbidden],
    ["failed", { state: "failed", draft: draft() }, copy.failed],
  ] as const)(
    "reports no violations after a %s save",
    async (_name, answer: ProfileEditFormState, message) => {
      const user = userEvent.setup();
      const { container } = renderForm(answer);

      await user.click(screen.getByRole("button", { name: copy.save }));
      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent(message);
      });
      await waitFor(() => {
        expect(screen.getByRole("button", { name: copy.save })).toBeEnabled();
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
