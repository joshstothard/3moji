import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserEvent } from "@testing-library/user-event";
import type { ProfileDraft, ProfileViolation } from "@template/core";

import { ProfileForm } from "./profile-form";
import type { ProfileEditFormState } from "./profile-edit-state";
import en from "../../../../packages/shared/messages/en.json";

const copy = en.ProfileEdit;
const ENCODED = "%F0%9F%A7%8A%F0%9F%A7%8A%F0%9F%A7%8A";

const draft = (overrides: Partial<ProfileDraft> = {}): ProfileDraft => ({
  displayName: "Ice Cube",
  bio: "Three of them.",
  links: [{ title: "Home", url: "https://example.com" }],
  ...overrides,
});

/**
 * The action, substituted. `useActionState` calls it with the previous state
 * and the submitted `FormData`, so this both records what the form posted and
 * decides what comes back — which is the whole contract the form has with the
 * server.
 */
function createAction(answer: ProfileEditFormState) {
  const posted: FormData[] = [];
  const save = (
    _previous: ProfileEditFormState,
    formData: FormData,
  ): Promise<ProfileEditFormState> => {
    posted.push(formData);
    return Promise.resolve(answer);
  };
  return { save, posted };
}

const renderForm = (
  answer: ProfileEditFormState,
  initial: ProfileDraft = draft(),
) => {
  const action = createAction(answer);
  render(<ProfileForm handle={ENCODED} initial={initial} save={action.save} />);
  return action;
};

/**
 * Submit, and wait for the answer to have been rendered.
 *
 * The button says "Saving…" and is disabled while the action is in flight, so
 * waiting for it to come back is waiting for the new state — without which an
 * assertion can read the form as it was *before* the response and pass or fail
 * on timing rather than on behaviour.
 */
const submit = async (user: UserEvent): Promise<void> => {
  await user.click(screen.getByRole("button", { name: copy.save }));
  await waitFor(() => {
    expect(screen.getByRole("button", { name: copy.save })).toBeEnabled();
  });
};

const IDLE: ProfileEditFormState = { state: "idle" };

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

describe("the Profile form", () => {
  it("opens on the Profile as it stands", () => {
    renderForm(IDLE);

    expect(screen.getByLabelText(copy.displayNameLabel)).toHaveValue(
      "Ice Cube",
    );
    expect(screen.getByLabelText(copy.bioLabel)).toHaveValue("Three of them.");
    expect(
      screen.getByLabelText(copy.linkTitleLabel.replace("{position}", "1")),
    ).toHaveValue("Home");
  });

  it("posts what was typed, with the Handle it was given", async () => {
    const user = userEvent.setup();
    const action = renderForm(IDLE);

    await user.clear(screen.getByLabelText(copy.displayNameLabel));
    await user.type(screen.getByLabelText(copy.displayNameLabel), "Frozen");
    await submit(user);

    const posted = action.posted[0];
    expect(posted?.get("handle")).toBe(ENCODED);
    expect(posted?.get("displayName")).toBe("Frozen");
    expect(posted?.get("link-0-title")).toBe("Home");
    expect(posted?.get("link-0-url")).toBe("https://example.com");
  });

  it("adds a Link row, numbered after the last", async () => {
    const user = userEvent.setup();
    const action = renderForm(IDLE);

    await user.click(screen.getByRole("button", { name: copy.addLink }));
    await user.type(
      screen.getByLabelText(copy.linkTitleLabel.replace("{position}", "2")),
      "Second",
    );
    await user.type(
      screen.getByLabelText(copy.linkUrlLabel.replace("{position}", "2")),
      "https://b.example",
    );
    await submit(user);

    expect(action.posted[0]?.get("link-1-title")).toBe("Second");
    expect(action.posted[0]?.get("link-1-url")).toBe("https://b.example");
  });

  /**
   * Removing row 1 of two must leave the survivor posting as **row 0**, not as
   * row 1 with a gap: `position` is the array index, and a gap would either
   * write a hole into the list or silently keep the removed Link's slot.
   */
  it("removes a Link row and renumbers the rest", async () => {
    const user = userEvent.setup();
    const action = renderForm(
      IDLE,
      draft({
        links: [
          { title: "First", url: "https://a.example" },
          { title: "Second", url: "https://b.example" },
        ],
      }),
    );

    await user.click(
      screen.getByRole("button", {
        name: copy.removeLink.replace("{position}", "1"),
      }),
    );
    await submit(user);

    const posted = action.posted[0];
    expect(posted?.get("link-0-title")).toBe("Second");
    expect(posted?.get("link-1-title")).toBeNull();
  });
});

describe("the Profile form, when the save is rejected", () => {
  const rejected: ProfileEditFormState = {
    state: "invalid",
    violations: [tooLongBio, badUrl],
    draft: draft({
      displayName: "A much longer name",
      bio: "y".repeat(170),
      links: [{ title: "Dodgy", url: "javascript:alert(1)" }],
    }),
  };

  /**
   * **A failed save must not lose what the user typed.** The form re-renders
   * from the draft the action sent back — the only thing that survives the
   * round trip — so every field the owner filled in is still there to fix.
   */
  it("keeps every field the owner typed", async () => {
    const user = userEvent.setup();
    renderForm(rejected);

    await submit(user);

    expect(screen.getByLabelText(copy.displayNameLabel)).toHaveValue(
      "A much longer name",
    );
    expect(screen.getByLabelText(copy.bioLabel)).toHaveValue("y".repeat(170));
    expect(
      screen.getByLabelText(copy.linkTitleLabel.replace("{position}", "1")),
    ).toHaveValue("Dodgy");
    expect(
      screen.getByLabelText(copy.linkUrlLabel.replace("{position}", "1")),
    ).toHaveValue("javascript:alert(1)");
  });

  /**
   * **Associated, not merely adjacent.** A message rendered as red text beside
   * an input is invisible to a screen reader user, who hears the label and the
   * value and nothing about the problem. `aria-invalid` marks the control and
   * `aria-describedby` points at the message by id.
   */
  it("associates each message with its own field", async () => {
    const user = userEvent.setup();
    renderForm(rejected);

    await submit(user);

    const bio = screen.getByLabelText(copy.bioLabel);
    expect(bio).toHaveAttribute("aria-invalid", "true");
    const bioDescribedBy = bio.getAttribute("aria-describedby");
    expect(bioDescribedBy).not.toBeNull();
    expect(document.getElementById(bioDescribedBy ?? "")).toHaveTextContent(
      "Use 160 characters or fewer. This is 170.",
    );

    const url = screen.getByLabelText(
      copy.linkUrlLabel.replace("{position}", "1"),
    );
    expect(url).toHaveAttribute("aria-invalid", "true");
    const urlDescribedBy = url.getAttribute("aria-describedby");
    expect(document.getElementById(urlDescribedBy ?? "")).toHaveTextContent(
      copy.errorLinkUrlScheme,
    );
  });

  /** A field with nothing wrong with it is not marked invalid or described. */
  it("leaves the untouched fields unmarked", async () => {
    const user = userEvent.setup();
    renderForm(rejected);

    await submit(user);

    const name = screen.getByLabelText(copy.displayNameLabel);
    expect(name).toHaveAttribute("aria-invalid", "false");
    expect(name).not.toHaveAttribute("aria-describedby");
  });

  /**
   * The numbers in the message are the **violation's own**, so the form never
   * restates a limit `validateProfile` owns. A limit that moved in the domain
   * and not here would be a form telling people the wrong rule.
   */
  it("states the limit the domain reported, not one of its own", async () => {
    const user = userEvent.setup();
    renderForm({
      state: "invalid",
      violations: [{ field: "bio", rule: "too-long", limit: 99, length: 120 }],
      draft: draft(),
    });

    await submit(user);

    expect(
      screen.getByText("Use 99 characters or fewer. This is 120."),
    ).toBeInTheDocument();
  });

  it("announces that the save did not happen", async () => {
    const user = userEvent.setup();
    renderForm(rejected);

    await submit(user);

    expect(screen.getByRole("alert")).toHaveTextContent(copy.invalidSummary);
  });

  it("says the whole list is too long, attached to the Links group", async () => {
    const user = userEvent.setup();
    renderForm({
      state: "invalid",
      violations: [{ field: "links", rule: "too-many", limit: 10, count: 11 }],
      draft: draft(),
    });

    await submit(user);

    const group = screen.getByRole("group");
    const describedBy = group.getAttribute("aria-describedby");
    expect(document.getElementById(describedBy ?? "")).toHaveTextContent(
      "Keep 10 links or fewer. This is 11.",
    );
  });

  /**
   * A refusal is a failed save too, and the likeliest way a real owner meets
   * one is a session that expired while they were writing — so it keeps what
   * they typed for the same reason a rejected draft does.
   */
  it("tells somebody whose session no longer owns this Handle, without losing their work", async () => {
    const user = userEvent.setup();
    renderForm({
      state: "forbidden",
      draft: draft({ bio: "Typed while the session expired." }),
    });

    await submit(user);

    expect(screen.getByRole("alert")).toHaveTextContent(copy.forbidden);
    expect(screen.getByLabelText(copy.bioLabel)).toHaveValue(
      "Typed while the session expired.",
    );
  });

  it("keeps the draft when the write itself failed", async () => {
    const user = userEvent.setup();
    renderForm({
      state: "failed",
      draft: draft({ bio: "Written twice, saved never." }),
    });

    await submit(user);

    expect(screen.getByRole("alert")).toHaveTextContent(copy.failed);
    expect(screen.getByLabelText(copy.bioLabel)).toHaveValue(
      "Written twice, saved never.",
    );
  });
});

describe("the Profile form, from the keyboard", () => {
  /**
   * Every control is reachable by tab, in the order it reads, and the submit is
   * the last of them. WCAG 2.1.1 — and the buttons are real `<button>`s rather
   * than click handlers on a `<div>`, which is what makes this pass.
   */
  it("reaches every control in order", async () => {
    const user = userEvent.setup();
    renderForm(IDLE, draft({ links: [{ title: "Home", url: "https://e.x" }] }));

    await user.tab();
    expect(screen.getByLabelText(copy.displayNameLabel)).toHaveFocus();
    await user.tab();
    expect(screen.getByLabelText(copy.bioLabel)).toHaveFocus();
    /*
     * The reorder buttons come before the row's fields, and **both of them are
     * in the tab order even on a one-Link list**, where neither has anywhere to
     * go. They are `aria-disabled`, not `disabled`: a control that disables
     * itself when pressed takes the focus with it, which is what would make
     * moving a Link two places require tabbing back from the top of the page.
     */
    await user.tab();
    expect(
      screen.getByRole("button", {
        name: copy.moveLinkUp.replace("{position}", "1"),
      }),
    ).toHaveFocus();
    await user.tab();
    expect(
      screen.getByRole("button", {
        name: copy.moveLinkDown.replace("{position}", "1"),
      }),
    ).toHaveFocus();
    await user.tab();
    expect(
      screen.getByLabelText(copy.linkTitleLabel.replace("{position}", "1")),
    ).toHaveFocus();
    await user.tab();
    expect(
      screen.getByLabelText(copy.linkUrlLabel.replace("{position}", "1")),
    ).toHaveFocus();
    await user.tab();
    expect(
      screen.getByRole("button", {
        name: copy.removeLink.replace("{position}", "1"),
      }),
    ).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: copy.addLink })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: copy.save })).toHaveFocus();
  });

  /** Every focusable control carries a visible focus ring. WCAG 2.4.7. */
  it("gives every control a visible focus style", () => {
    renderForm(IDLE);

    const focusable = [
      screen.getByLabelText(copy.displayNameLabel),
      screen.getByLabelText(copy.bioLabel),
      screen.getByLabelText(copy.linkTitleLabel.replace("{position}", "1")),
      screen.getByRole("button", {
        name: copy.moveLinkUp.replace("{position}", "1"),
      }),
      screen.getByRole("button", {
        name: copy.moveLinkDown.replace("{position}", "1"),
      }),
      screen.getByRole("button", { name: copy.addLink }),
      screen.getByRole("button", { name: copy.save }),
    ];

    for (const control of focusable) {
      expect(control.className).toContain("focus-visible:outline");
    }
  });
});
