import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserEvent } from "@testing-library/user-event";
import type { ProfileDraft } from "@template/core";

import { ProfileForm } from "./profile-form";
import type { ProfileEditFormState } from "./profile-edit-state";
import en from "../../../../packages/shared/messages/en.json";

const copy = en.ProfileEdit;
const ENCODED = "%F0%9F%A7%8A%F0%9F%A7%8A%F0%9F%A7%8A";
const IDLE: ProfileEditFormState = { state: "idle" };

const THREE: ProfileDraft = {
  displayName: "Ice Cube",
  bio: "Three of them.",
  links: [
    { title: "Home", url: "https://home.example" },
    { title: "Shop", url: "https://shop.example" },
    { title: "Blog", url: "https://blog.example" },
  ],
};

function createAction() {
  const posted: FormData[] = [];
  const save = (
    _previous: ProfileEditFormState,
    formData: FormData,
  ): Promise<ProfileEditFormState> => {
    posted.push(formData);
    return Promise.resolve(IDLE);
  };
  return { save, posted };
}

const renderForm = (initial: ProfileDraft = THREE) => {
  const action = createAction();
  render(<ProfileForm handle={ENCODED} initial={initial} save={action.save} />);
  return action;
};

const submit = async (user: UserEvent): Promise<void> => {
  await user.click(screen.getByRole("button", { name: copy.save }));
  await waitFor(() => {
    expect(screen.getByRole("button", { name: copy.save })).toBeEnabled();
  });
};

/** The titles the form is showing, top to bottom. */
function titlesInOrder(): readonly string[] {
  return screen
    .getAllByRole("textbox", { name: /: title$/ })
    .map((input) => (input as HTMLInputElement).value);
}

const moveUp = (position: number) =>
  screen.getByRole("button", {
    name: copy.moveLinkUp.replace("{position}", String(position)),
  });

const moveDown = (position: number) =>
  screen.getByRole("button", {
    name: copy.moveLinkDown.replace("{position}", String(position)),
  });

const announcement = () => screen.getByRole("status").textContent;

const named = (title: string, position: number, total: number) =>
  copy.reorderAnnouncement
    .replace("{title}", title)
    .replace("{position}", String(position))
    .replace("{total}", String(total));

describe("reordering Links with the keyboard", () => {
  it("moves a Link one place up", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(moveUp(2));

    expect(titlesInOrder()).toEqual(["Shop", "Home", "Blog"]);
  });

  it("moves a Link one place down", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(moveDown(2));

    expect(titlesInOrder()).toEqual(["Home", "Blog", "Shop"]);
  });

  /**
   * The move buttons are reachable by keyboard alone — no pointer anywhere in
   * this test. WCAG 2.1.1: a reorder only a mouse can drive is not operable.
   */
  it("is operable by keyboard alone, with no pointer at all", async () => {
    const user = userEvent.setup();
    renderForm();

    moveUp(3).focus();
    await user.keyboard("{Enter}");

    expect(titlesInOrder()).toEqual(["Home", "Blog", "Shop"]);
  });

  /**
   * The order the form shows is the order it posts, because `position` is the
   * array index — so a reorder that did not survive the submit would look
   * right and save wrong.
   */
  it("posts the Links in their new order, which is what persists", async () => {
    const user = userEvent.setup();
    const action = renderForm();

    await user.click(moveUp(3));
    await submit(user);

    const posted = action.posted[0];
    expect(posted?.get("link-0-title")).toBe("Home");
    expect(posted?.get("link-1-title")).toBe("Blog");
    expect(posted?.get("link-1-url")).toBe("https://blog.example");
    expect(posted?.get("link-2-title")).toBe("Shop");
  });

  /**
   * Typing a title re-renders the whole list, because the title is mirrored
   * into state so the announcement can name the Link. **Nothing else the owner
   * has typed may be disturbed by that**: the URL field has no such mirror, so
   * its `defaultValue` stays at the value it was seeded with while the DOM node
   * holds something else. A re-render that reset it would silently discard a
   * web address the owner had just typed.
   */
  it("leaves what was typed elsewhere alone when a title is edited", async () => {
    const user = userEvent.setup();
    const action = renderForm();

    const url = screen.getByLabelText(
      copy.linkUrlLabel.replace("{position}", "2"),
    );
    await user.clear(url);
    await user.type(url, "https://elsewhere.example");
    await user.type(
      screen.getByLabelText(copy.linkTitleLabel.replace("{position}", "2")),
      "ping",
    );
    await submit(user);

    expect(action.posted[0]?.get("link-1-url")).toBe(
      "https://elsewhere.example",
    );
    expect(action.posted[0]?.get("link-1-title")).toBe("Shopping");
  });

  /** The mirrored title is the one announced, not the one it was loaded with. */
  it("announces the Link by the title the owner has just given it", async () => {
    const user = userEvent.setup();
    renderForm();

    const title = screen.getByLabelText(
      copy.linkTitleLabel.replace("{position}", "3"),
    );
    await user.clear(title);
    await user.type(title, "Journal");
    await user.click(moveUp(3));

    expect(announcement()).toBe(named("Journal", 2, 3));
  });

  it("announces the Link's new position to assistive technology", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(moveUp(3));

    expect(announcement()).toBe(named("Blog", 2, 3));
  });

  it("says which position each Link is at, rather than leaving it to the order", () => {
    renderForm();

    expect(
      screen.getByText(
        copy.linkPosition.replace("{position}", "2").replace("{total}", "3"),
      ),
    ).toBeInTheDocument();
  });

  /**
   * The buttons at the ends stay in the tab order and keep focus: disabling
   * the one that was just pressed drops focus to `<body>`, which makes the
   * next move start from the top of the page.
   */
  it("keeps the end buttons focusable, marked as unavailable rather than removed", () => {
    renderForm();

    expect(moveUp(1)).toHaveAttribute("aria-disabled", "true");
    expect(moveDown(3)).toHaveAttribute("aria-disabled", "true");
    expect(moveUp(2)).toHaveAttribute("aria-disabled", "false");
  });

  it("says a Link is already first rather than silently doing nothing", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(moveUp(1));

    expect(titlesInOrder()).toEqual(["Home", "Shop", "Blog"]);
    expect(announcement()).toBe(copy.reorderAtStart.replace("{title}", "Home"));
  });

  it("says a Link is already last", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(moveDown(3));

    expect(titlesInOrder()).toEqual(["Home", "Shop", "Blog"]);
    expect(announcement()).toBe(copy.reorderAtEnd.replace("{title}", "Blog"));
  });

  it("names a Link with no title yet, so the announcement is still about something", async () => {
    const user = userEvent.setup();
    renderForm({
      ...THREE,
      links: [
        { title: "Home", url: "https://home.example" },
        { title: "", url: "https://untitled.example" },
      ],
    });

    await user.click(moveUp(2));

    expect(announcement()).toBe(named(copy.linkUntitled, 1, 2));
  });

  /**
   * Focus follows the Link, not the position. Pressing "move up" twice in a
   * row is the ordinary way to move something two places, and it only works if
   * the button is still focused afterwards.
   */
  it("leaves focus on the button that was pressed", async () => {
    const user = userEvent.setup();
    renderForm();

    const button = moveUp(3);
    button.focus();
    await user.keyboard("{Enter}");

    expect(document.activeElement).toBe(button);
  });

  /**
   * **Two reorders with no render between them.** Both handlers run against
   * the same committed state, so a non-functional `setRows` updater applies
   * the second on top of a stale list and the first move is lost — an
   * interleaved order rather than a consistent one. `user.click` flushes a
   * render between clicks and would not reproduce it; these two dispatches
   * share one `act`.
   */
  it("applies two reorders in quick succession, not just the last one", () => {
    renderForm();

    const button = moveUp(3);
    act(() => {
      button.click();
      button.click();
    });

    expect(titlesInOrder()).toEqual(["Blog", "Home", "Shop"]);
  });
});

/**
 * A violation names the Link by its **index**, so a reorder after a rejected
 * save is where a message can end up on the wrong Link — pointing at a perfectly
 * good address and saying it is not a web address. The message has to travel
 * with the Link it is about.
 */
describe("reordering after a save was refused", () => {
  const refused: ProfileEditFormState = {
    state: "invalid",
    violations: [{ field: "link.url", index: 1, rule: "malformed-url" }],
    draft: {
      displayName: "Ice Cube",
      bio: "",
      links: [
        { title: "Home", url: "https://home.example" },
        { title: "Shop", url: "not a url" },
        { title: "Blog", url: "https://blog.example" },
      ],
    },
  };

  const renderRefused = () => {
    const save = (): Promise<ProfileEditFormState> => Promise.resolve(refused);
    render(<ProfileForm handle={ENCODED} initial={THREE} save={save} />);
  };

  it("keeps each message on the Link it is about", async () => {
    const user = userEvent.setup();
    renderRefused();

    await user.click(screen.getByRole("button", { name: copy.save }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: copy.save })).toBeEnabled();
    });
    // "Shop" is the broken one, at position 2. Move it to the top.
    await user.click(moveUp(2));

    expect(titlesInOrder()).toEqual(["Shop", "Home", "Blog"]);
    const brokenUrl = screen.getByLabelText(
      copy.linkUrlLabel.replace("{position}", "1"),
    );
    expect(brokenUrl).toHaveValue("not a url");
    expect(brokenUrl).toHaveAttribute("aria-invalid", "true");
    expect(
      screen.getByLabelText(copy.linkUrlLabel.replace("{position}", "2")),
    ).toHaveAttribute("aria-invalid", "false");
  });
});

/** A `DataTransfer` stub: jsdom fires drag events without one. */
const dataTransfer = () => ({
  setData: () => undefined,
  getData: () => "",
  effectAllowed: "move",
  dropEffect: "move",
});

describe("reordering Links by dragging", () => {
  const handle = (position: number) =>
    screen.getByTestId(`link-drag-handle-${String(position - 1)}`);
  const row = (position: number) =>
    screen.getByTestId(`link-row-${String(position - 1)}`);

  it("drops a Link onto an earlier row and puts it there", () => {
    renderForm();

    fireEvent.dragStart(handle(3), { dataTransfer: dataTransfer() });
    fireEvent.dragOver(row(1), { dataTransfer: dataTransfer() });
    fireEvent.drop(row(1), { dataTransfer: dataTransfer() });

    expect(titlesInOrder()).toEqual(["Blog", "Home", "Shop"]);
  });

  it("drops a Link onto a later row and puts it there", () => {
    renderForm();

    fireEvent.dragStart(handle(1), { dataTransfer: dataTransfer() });
    fireEvent.drop(row(3), { dataTransfer: dataTransfer() });

    expect(titlesInOrder()).toEqual(["Shop", "Blog", "Home"]);
  });

  it("announces a dropped Link's new position, the same as the keyboard path", () => {
    renderForm();

    fireEvent.dragStart(handle(3), { dataTransfer: dataTransfer() });
    fireEvent.drop(row(1), { dataTransfer: dataTransfer() });

    expect(announcement()).toBe(named("Blog", 1, 3));
  });

  it("leaves the order alone when a drop arrives with nothing being dragged", () => {
    renderForm();

    fireEvent.drop(row(1), { dataTransfer: dataTransfer() });

    expect(titlesInOrder()).toEqual(["Home", "Shop", "Blog"]);
  });

  it("forgets the dragged Link once the drag ends", () => {
    renderForm();

    fireEvent.dragStart(handle(3), { dataTransfer: dataTransfer() });
    fireEvent.dragEnd(handle(3), { dataTransfer: dataTransfer() });
    fireEvent.drop(row(1), { dataTransfer: dataTransfer() });

    expect(titlesInOrder()).toEqual(["Home", "Shop", "Blog"]);
  });

  /**
   * The drag affordance is hidden from assistive technology on purpose: it
   * cannot be operated without a pointer, and the move buttons beside it do
   * the same job for everyone else. Exposing it would offer a control that
   * does nothing when activated.
   */
  it("hides the drag affordance from assistive technology", () => {
    renderForm();

    expect(handle(1)).toHaveAttribute("aria-hidden", "true");
  });
});
