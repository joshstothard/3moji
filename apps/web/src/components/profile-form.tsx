"use client";

import { useActionState, useState } from "react";
import type { DragEvent } from "react";
import type { ProfileDraft, ProfileViolation } from "@template/core";
/*
 * **From `/browser`, not from the package root.** This is a client component,
 * and the root entry re-exports `db/client`, which reaches `pg` — bundling that
 * for the browser fails `next build` on `dns`, `fs` and `net`. `browser.ts` is
 * the allowlist of pure domain functions that may cross into a bundle, and
 * `moveLink` is one. The types above are erased at compile time, so they may
 * come from the root.
 */
import { moveLink } from "@template/core/browser";

import type { ProfileEditFormState, SaveProfile } from "./profile-edit-state";
import en from "../../../../packages/shared/messages/en.json";

const copy = en.ProfileEdit;

/**
 * Exactly the `field:rule` pairs {@link ProfileViolation} can produce —
 * **derived from the union, not the cross product of its two discriminants**,
 * so `displayName:unsupported-scheme` is not a key anybody has to write copy
 * for, and a seventh violation variant fails to compile here rather than
 * rendering blank.
 */
type ViolationKey = ProfileViolation extends infer Variant
  ? Variant extends { readonly field: infer F extends string }
    ? Variant extends { readonly rule: infer R extends string }
      ? `${F}:${R}`
      : never
    : never
  : never;

/**
 * One message per thing that can be wrong, and a `Record` over the derived
 * union rather than a `switch` — the idiom `AVAILABILITY_COPY` uses on the
 * Handle page, for the same reason.
 *
 * **The numbers are the violation's own.** `{limit}`, `{length}` and `{count}`
 * are filled from the value `validateProfile` reported, so the limits are
 * stated in one place in the codebase and this form is not a second one that
 * can drift from it.
 */
const VIOLATION_COPY: Readonly<Record<ViolationKey, string>> = {
  "displayName:too-long": copy.errorDisplayNameTooLong,
  "bio:too-long": copy.errorBioTooLong,
  "links:too-many": copy.errorLinksTooMany,
  "link.title:too-long": copy.errorLinkTitleTooLong,
  "link.url:unsupported-scheme": copy.errorLinkUrlScheme,
  "link.url:malformed-url": copy.errorLinkUrlMalformed,
};

/**
 * A violation's copy key.
 *
 * A `switch` over `field` rather than one template built from both
 * discriminants, because the union's variants do not share rules: narrowing
 * first is what makes each arm's `rule` the handful that field can actually
 * break, instead of the cross product of every field with every rule — which is
 * how "displayName:unsupported-scheme" would otherwise become a key somebody
 * had to write copy for. It stays exhaustive in both directions: a new field
 * fails to compile here, and a new rule fails to compile in
 * {@link VIOLATION_COPY}.
 */
function keyOf(violation: ProfileViolation): ViolationKey {
  switch (violation.field) {
    case "displayName":
      return `displayName:${violation.rule}`;
    case "bio":
      return `bio:${violation.rule}`;
    case "links":
      return `links:${violation.rule}`;
    case "link.title":
      return `link.title:${violation.rule}`;
    case "link.url":
      return `link.url:${violation.rule}`;
  }
}

/**
 * A violation as a sentence, with its own numbers in it.
 *
 * `in` rather than a cast: the variants carry different fields, and this
 * package forbids both the non-null assertion and the assertion style that
 * would stand in for narrowing.
 */
function messageFor(violation: ProfileViolation): string {
  return VIOLATION_COPY[keyOf(violation)]
    .replace("{limit}", "limit" in violation ? String(violation.limit) : "")
    .replace("{length}", "length" in violation ? String(violation.length) : "")
    .replace("{count}", "count" in violation ? String(violation.count) : "");
}

/**
 * One editable Link row. `id` is React's key and never leaves the browser.
 *
 * **The key is what makes reordering safe.** The inputs are uncontrolled, so
 * what the owner has typed lives in the DOM node rather than in this object;
 * keying on an identity that travels with the Link is what makes React *move*
 * that node instead of re-labelling the node that happens to sit at the new
 * index. Key on the index and a reorder would leave every value where it was
 * and merely renumber the labels — the order would look changed and save
 * unchanged.
 *
 * `title` is mirrored back into state as it is typed, and only so that the
 * reorder announcement can name the Link the way the owner has just named it.
 * It is not the input's source of truth; the DOM node is.
 */
interface LinkRow {
  readonly id: number;
  readonly title: string;
  readonly url: string;
  /**
   * What the last refused save said was wrong with **this Link**, carried on
   * the row rather than looked up by index.
   *
   * A {@link ProfileViolation} names its Link by position in the submitted
   * list, which stops being true the moment the owner reorders: a message
   * matched on the index would stay where it was and end up pointing at a
   * perfectly good address, saying it is not a web address. Attaching it here
   * once, when the refusal arrives, is what makes it travel with its Link.
   */
  readonly violations: readonly ProfileViolation[];
}

/**
 * The Link list and what was last said about it, **as one value**.
 *
 * They are one piece of state because they are one fact: a move rearranges the
 * list *and* is the thing announced, and computing the announcement anywhere
 * but inside the updater that produced the new list means computing it from a
 * list that may already be out of date. Two reorders dispatched before React
 * re-renders — a double press, or a press during a drop — are exactly that
 * case, and the acceptance criterion that names it.
 */
interface LinkListState {
  readonly rows: readonly LinkRow[];
  /** Empty until the owner moves something. Rendered into the live region. */
  readonly announcement: string;
}

export interface ProfileFormProps {
  /** The percent-encoded Handle being edited, posted back for the authority check. */
  readonly handle: string;
  /** What the Profile says now. An owner who has never edited gets blanks. */
  readonly initial: ProfileDraft;
  /** The server action. Injected, so a test substitutes one rather than a runtime. */
  readonly save: SaveProfile;
}

const IDLE: ProfileEditFormState = { state: "idle" };

/**
 * The owner's edit form: a display name, a bio, and a list of Links.
 *
 * **Nothing here knows a limit.** The rules are `validateProfile`'s, the check
 * is the server action's, and what this renders is whatever came back — so the
 * form and the domain cannot drift apart, which is the failure that follows
 * from restating "30" in a `maxLength`. (It would be a lie besides: an HTML
 * `maxLength` counts UTF-16 units, and the limit is in code points, so a
 * 30-emoji display name would be cut off at fifteen.)
 *
 * **A refused save keeps what was typed.** The inputs re-render from the draft
 * the action sent back, not from whatever the browser left behind, because a
 * server action's answer is the only thing that survives the round trip.
 *
 * **Each message is associated with its field, not merely next to it.**
 * `aria-invalid` marks the control and `aria-describedby` points at the message
 * by id, so a screen reader announces the problem when the control takes focus.
 * The summary at the top is an addition for sighted keyboard users, not the
 * mechanism.
 *
 * **Reordering is here, by two paths that are one rule.** The move buttons and
 * the drag handle both hand a pair of indices to `moveLink` in
 * `packages/core`, so the keyboard path cannot drift into producing a different
 * order from the pointer path. The keyboard path is the one that has to work:
 * a reorder only a mouse can drive fails WCAG 2.1.1 outright, and dragging is
 * the addition.
 */
export function ProfileForm({ handle, initial, save }: ProfileFormProps) {
  const [state, formAction, pending] = useActionState(save, IDLE);

  /**
   * What the fields show: the rejected draft when there is one, otherwise the
   * Profile as it stands.
   */
  const source: ProfileDraft = "draft" in state ? state.draft : initial;

  const violations = state.state === "invalid" ? state.violations : [];

  const [list, setList] = useState<LinkListState>(() =>
    listOf(source, violations),
  );
  /** Which row a drag is carrying, or `undefined` when none is in flight. */
  const [dragging, setDragging] = useState<number | undefined>(undefined);
  /**
   * Re-seed the rows when a submission comes back — React's documented way of
   * adjusting state to a change, and deliberately not an effect: an effect
   * would render the stale list once first, which for a rejected save means
   * flashing the owner's Links back to how they were before they edited them.
   */
  const [seen, setSeen] = useState<ProfileEditFormState>(state);
  if (seen !== state) {
    setSeen(state);
    setList(listOf(source, violations));
  }

  const rows = list.rows;

  /**
   * The whole-form violations: the ones that are not about a particular Link.
   * A Link's own are on its row, so that they survive a reorder.
   */
  const of = (field: ProfileViolation["field"]) =>
    violations.filter((violation) => violation.field === field);

  /**
   * Move the Link **with this id** one place, in this direction.
   *
   * Two things here are what make two reorders in quick succession land on a
   * consistent order, and both are needed:
   *
   * - **A functional updater**, so the second move is applied to the first's
   *   result rather than to the list this render closed over. Reading the
   *   captured `rows` would apply both to the same stale list and keep only
   *   the last.
   * - **An id, not an index.** The index a row was rendered at is stale the
   *   instant the first move lands, so two presses of one button carrying a
   *   captured index would move whatever Link had *arrived* at that slot —
   *   pressing "move up" twice would move a Link up and then move it straight
   *   back down. "Move this Link up" is a statement about the Link; the
   *   position is looked up inside the updater, against the list as it is.
   */
  const moveBy = (id: number, places: number) => {
    setList((prev) => {
      const from = prev.rows.findIndex((row) => row.id === id);
      return reorderedList(prev, from, from + places);
    });
  };

  /** Drop the dragged Link onto the row this one currently occupies. */
  const moveOnto = (id: number, targetId: number) => {
    setList((prev) =>
      reorderedList(
        prev,
        prev.rows.findIndex((row) => row.id === id),
        prev.rows.findIndex((row) => row.id === targetId),
      ),
    );
  };

  /**
   * The new row's id is derived from the list **inside the updater**, for the
   * same reason a move names a Link rather than a slot: a counter held beside
   * the list is read from this render's closure, so two adds dispatched before
   * a re-render both claim the same id. Two rows sharing a `key` is not a
   * cosmetic warning — React reuses one row's DOM node for the other, and what
   * is typed into one field lands in both.
   */
  const addRow = () => {
    setList((prev) => ({
      ...prev,
      rows: [
        ...prev.rows,
        { id: nextIdFor(prev.rows), title: "", url: "", violations: [] },
      ],
    }));
  };

  const removeRow = (id: number) => {
    setList((prev) => ({
      ...prev,
      rows: prev.rows.filter((candidate) => candidate.id !== id),
    }));
  };

  /**
   * Mirror a typed title into state, so the announcement names the Link the
   * way the owner has just named it rather than the way it was loaded. The
   * input stays uncontrolled: this does not feed `value` back to it.
   */
  const retitleRow = (id: number, title: string) => {
    setList((prev) => ({
      ...prev,
      rows: prev.rows.map((candidate) =>
        candidate.id === id ? { ...candidate, title } : candidate,
      ),
    }));
  };

  return (
    <form action={formAction} className="mt-10 space-y-8">
      <input type="hidden" name="handle" value={handle} />

      <FormNotice state={state} violations={violations} />

      <Field
        id="profile-display-name"
        name="displayName"
        label={copy.displayNameLabel}
        defaultValue={source.displayName}
        violations={of("displayName")}
      />
      <Field
        id="profile-bio"
        name="bio"
        label={copy.bioLabel}
        defaultValue={source.bio}
        violations={of("bio")}
        multiline
      />

      <fieldset
        className="rounded-xl bg-white p-5 shadow-sm"
        aria-describedby={
          of("links").length > 0 ? "profile-links-error" : undefined
        }
      >
        <legend className="px-1 text-lg font-semibold text-slate-900">
          {copy.linksHeading}
        </legend>
        <Messages id="profile-links-error" violations={of("links")} />

        <ul className="space-y-6">
          {rows.map((row, index) => (
            <li
              key={row.id}
              onDragOver={(event: DragEvent<HTMLLIElement>) => {
                // Without this the browser refuses the drop outright: the
                // default action of `dragover` is "this is not a drop target".
                event.preventDefault();
              }}
              onDrop={(event: DragEvent<HTMLLIElement>) => {
                event.preventDefault();
                if (dragging === undefined) return;
                moveOnto(dragging, row.id);
                setDragging(undefined);
              }}
            >
              <LinkFields
                index={index}
                total={rows.length}
                row={row}
                titleViolations={row.violations.filter(
                  (violation) => violation.field === "link.title",
                )}
                urlViolations={row.violations.filter(
                  (violation) => violation.field === "link.url",
                )}
                onRemove={() => {
                  removeRow(row.id);
                }}
                onRetitle={(title) => {
                  retitleRow(row.id, title);
                }}
                onMoveUp={() => {
                  moveBy(row.id, -1);
                }}
                onMoveDown={() => {
                  moveBy(row.id, 1);
                }}
                onDragStart={() => {
                  setDragging(row.id);
                }}
                onDragEnd={() => {
                  setDragging(undefined);
                }}
              />
            </li>
          ))}
        </ul>

        <button type="button" onClick={addRow} className={SECONDARY_BUTTON}>
          {copy.addLink}
        </button>

        {/*
         * What just happened to the order, for anyone who cannot see it.
         *
         * `role="status"` is an `aria-live="polite"` region: it is present from
         * the first render and empty, so the text arriving in it is what gets
         * announced. Rendering the element only once there is something to say
         * is the usual way this silently fails — a live region has to be
         * observed before the change it carries.
         */}
        <p role="status" aria-live="polite" className="sr-only">
          {list.announcement}
        </p>
      </fieldset>

      <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
        {pending ? copy.saving : copy.save}
      </button>
    </form>
  );
}

function listOf(
  draft: ProfileDraft,
  violations: readonly ProfileViolation[],
): LinkListState {
  return {
    rows: draft.links.map((link, index) => ({
      id: index,
      title: link.title,
      url: link.url,
      // Matched by index **once**, here, at the only moment the index is still
      // the one the violations were reported against: the draft has just come
      // back from the server and nothing has been moved since.
      violations: violations.filter(
        (violation) => "index" in violation && violation.index === index,
      ),
    })),
    // Nothing has been moved yet, and a stale announcement surviving a
    // submission would have the live region repeat a move that is no longer
    // the most recent thing to have happened.
    announcement: "",
  };
}

/**
 * An id no row in this list is using: one past the highest.
 *
 * A `reduce` rather than `Math.max(...ids)`, which spreads an array into a call
 * — fine for ten Links and a habit that stops being fine at a hundred thousand.
 * The seed of `-1` is what makes the first id of an empty list `0`.
 */
function nextIdFor(rows: readonly LinkRow[]): number {
  return rows.reduce((highest, row) => Math.max(highest, row.id), -1) + 1;
}

/**
 * One move applied, and the sentence that describes it.
 *
 * **The refusal is a message, not silence.** `moveLink` answers with the very
 * same list when a move is out of range, which is what pressing "move up" on
 * the first Link does. Saying so is the difference between a control that
 * declines and a control that appears broken — and it is why the end buttons
 * can stay focusable rather than being disabled out from under the focus that
 * is on them.
 */
function reorderedList(
  previous: LinkListState,
  from: number,
  to: number,
): LinkListState {
  const rows = moveLink(previous.rows, from, to);
  if (rows !== previous.rows) {
    return { rows, announcement: movedMessage(rows, to) };
  }

  const moving = previous.rows[from];
  if (moving === undefined) return previous;
  if (to < 0) {
    return {
      ...previous,
      announcement: copy.reorderAtStart.replace("{title}", nameOf(moving)),
    };
  }
  if (to >= previous.rows.length) {
    return {
      ...previous,
      announcement: copy.reorderAtEnd.replace("{title}", nameOf(moving)),
    };
  }
  // A move to where it already is. Nothing happened and nothing is worth
  // saying — a drop onto a Link's own row is the way this is reached.
  return previous;
}

/** "Moved Shop to position 2 of 3." — the position **as it now is**. */
function movedMessage(rows: readonly LinkRow[], to: number): string {
  const moved = rows[to];
  if (moved === undefined) return "";
  return copy.reorderAnnouncement
    .replace("{title}", nameOf(moved))
    .replace("{position}", String(to + 1))
    .replace("{total}", String(rows.length));
}

/**
 * What to call a Link out loud.
 *
 * A Link the owner has added but not yet titled has no name, and "Moved  to
 * position 2 of 3" names nothing at all. The fallback is a word rather than the
 * row number, because the number is already in the sentence.
 */
function nameOf(row: LinkRow): string {
  return row.title.trim() === "" ? copy.linkUntitled : row.title;
}

/**
 * What went wrong with the whole attempt, announced.
 *
 * `role="alert"` so it reaches a screen reader when it appears after a
 * submission, rather than only when somebody happens to move focus to it.
 */
function FormNotice({
  state,
  violations,
}: {
  readonly state: ProfileEditFormState;
  readonly violations: readonly ProfileViolation[];
}) {
  const summary =
    state.state === "forbidden"
      ? copy.forbidden
      : state.state === "failed"
        ? copy.failed
        : violations.length > 0
          ? copy.invalidSummary
          : undefined;

  if (summary === undefined) return null;

  return (
    <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-rose-800">
      {summary}
    </p>
  );
}

/** The messages for one control, rendered where its `aria-describedby` points. */
function Messages({
  id,
  violations,
}: {
  readonly id: string;
  readonly violations: readonly ProfileViolation[];
}) {
  if (violations.length === 0) return null;

  return (
    <p id={id} className="mt-1 text-sm text-rose-700">
      {violations.map((violation) => messageFor(violation)).join(" ")}
    </p>
  );
}

const CONTROL =
  "mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600";
const PRIMARY_BUTTON =
  "rounded-xl bg-indigo-600 px-5 py-2.5 font-semibold text-white disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600";
const SECONDARY_BUTTON =
  "mt-4 rounded-xl bg-slate-100 px-4 py-2 font-medium text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600";

/**
 * One labelled control, with its messages attached **by id**.
 *
 * `aria-describedby` is set only when there is something to describe: pointing
 * at an element that is not there is a dangling reference, which some screen
 * readers announce as nothing and others as a repeat of the label.
 */
function Field({
  id,
  name,
  label,
  defaultValue,
  violations,
  multiline = false,
  onChange,
}: {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly defaultValue: string;
  readonly violations: readonly ProfileViolation[];
  readonly multiline?: boolean;
  /**
   * Told what was typed, for a caller that needs to know — the Link title,
   * whose announcement has to name the Link as it is called now. The control
   * stays uncontrolled either way: nothing here feeds a `value` back.
   */
  readonly onChange?: (value: string) => void;
}) {
  const errorId = `${id}-error`;
  const invalid = violations.length > 0;
  const shared = {
    id,
    name,
    defaultValue,
    className: CONTROL,
    "aria-invalid": invalid,
    "aria-describedby": invalid ? errorId : undefined,
    onChange:
      onChange === undefined
        ? undefined
        : (event: { readonly target: { readonly value: string } }) => {
            onChange(event.target.value);
          },
  };

  return (
    <div>
      <label htmlFor={id} className="font-medium text-slate-900">
        {label}
      </label>
      {multiline ? (
        <textarea {...shared} rows={4} />
      ) : (
        <input type="text" {...shared} />
      )}
      <Messages id={errorId} violations={violations} />
    </div>
  );
}

/**
 * One Link: a title, an address, and the button that removes it.
 *
 * The field names carry the **row index**, so a title and its URL stay together
 * however many rows there are — see the server action, which reads them back
 * that way rather than zipping two lists.
 */
function LinkFields({
  index,
  total,
  row,
  titleViolations,
  urlViolations,
  onRemove,
  onRetitle,
  onMoveUp,
  onMoveDown,
  onDragStart,
  onDragEnd,
}: {
  readonly index: number;
  readonly total: number;
  readonly row: LinkRow;
  readonly titleViolations: readonly ProfileViolation[];
  readonly urlViolations: readonly ProfileViolation[];
  readonly onRemove: () => void;
  readonly onRetitle: (title: string) => void;
  readonly onMoveUp: () => void;
  readonly onMoveDown: () => void;
  readonly onDragStart: () => void;
  readonly onDragEnd: () => void;
}) {
  const position = String(index + 1);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {/*
         * The pointer affordance, and **hidden from assistive technology on
         * purpose**: it cannot be operated without a pointer, and the two
         * buttons beside it do the same job. Exposing it would offer a control
         * that does nothing when activated. It is not focusable either, so it
         * is not a WCAG 2.1.1 failure hidden behind `aria-hidden` — the
         * keyboard route is a separate, equal control rather than this one
         * with a caveat.
         */}
        <span
          aria-hidden="true"
          draggable
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          title={copy.dragLinkHandle.replace("{position}", position)}
          className="cursor-grab px-1 text-slate-400 select-none"
        >
          ⠿
        </span>
        <p className="font-medium text-slate-700">
          {copy.linkPosition
            .replace("{position}", position)
            .replace("{total}", String(total))}
        </p>
        <ReorderButton
          label={copy.moveLinkUp.replace("{position}", position)}
          glyph="↑"
          atEnd={index === 0}
          onActivate={onMoveUp}
        />
        <ReorderButton
          label={copy.moveLinkDown.replace("{position}", position)}
          glyph="↓"
          atEnd={index === total - 1}
          onActivate={onMoveDown}
        />
      </div>
      <Field
        id={`profile-link-${String(index)}-title`}
        name={`link-${String(index)}-title`}
        label={copy.linkTitleLabel.replace("{position}", position)}
        defaultValue={row.title}
        violations={titleViolations}
        onChange={onRetitle}
      />
      <Field
        id={`profile-link-${String(index)}-url`}
        name={`link-${String(index)}-url`}
        label={copy.linkUrlLabel.replace("{position}", position)}
        defaultValue={row.url}
        violations={urlViolations}
      />
      <button
        type="button"
        onClick={onRemove}
        className="text-sm font-medium text-indigo-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
      >
        {copy.removeLink.replace("{position}", position)}
      </button>
    </div>
  );
}

/**
 * One move-this-Link button.
 *
 * **`aria-disabled`, never `disabled`.** The button at an end of the list has
 * nothing to do, but disabling it is what breaks the interaction it is part of:
 * moving a Link to the top disables the very button that was just pressed, the
 * browser drops focus to `<body>`, and the next move starts from the top of the
 * page. `aria-disabled` tells assistive technology the same thing while leaving
 * the control focusable, and pressing it announces why nothing happened rather
 * than leaving the owner to wonder.
 *
 * The accessible name carries the Link's **current** position, so the control
 * is identifiable on its own — "Move link 2 up" rather than an arrow whose
 * meaning depends on which row a sighted user can see it in.
 */
function ReorderButton({
  label,
  glyph,
  atEnd,
  onActivate,
}: {
  readonly label: string;
  readonly glyph: string;
  /** At the end of the list this button moves towards: it has nowhere to go. */
  readonly atEnd: boolean;
  readonly onActivate: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-disabled={atEnd}
      onClick={onActivate}
      className={`rounded-lg px-2 py-1 text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 ${
        atEnd ? "opacity-40" : "hover:bg-slate-100"
      }`}
    >
      <span aria-hidden="true">{glyph}</span>
    </button>
  );
}
