"use client";

import { useActionState, useState } from "react";
import type { ProfileDraft, ProfileViolation } from "@template/core";

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

/** One editable Link row. `id` is React's key and never leaves the browser. */
interface LinkRow {
  readonly id: number;
  readonly title: string;
  readonly url: string;
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
 * **Reordering is not here.** #107 owns it; the row order is the list order.
 */
export function ProfileForm({ handle, initial, save }: ProfileFormProps) {
  const [state, formAction, pending] = useActionState(save, IDLE);

  /**
   * What the fields show: the rejected draft when there is one, otherwise the
   * Profile as it stands.
   */
  const source: ProfileDraft = "draft" in state ? state.draft : initial;

  const [rows, setRows] = useState<readonly LinkRow[]>(() => rowsOf(source));
  const [nextId, setNextId] = useState(source.links.length);
  /**
   * Re-seed the rows when a submission comes back — React's documented way of
   * adjusting state to a change, and deliberately not an effect: an effect
   * would render the stale list once first, which for a rejected save means
   * flashing the owner's Links back to how they were before they edited them.
   */
  const [seen, setSeen] = useState<ProfileEditFormState>(state);
  if (seen !== state) {
    setSeen(state);
    setRows(rowsOf(source));
    setNextId(source.links.length);
  }

  const violations = state.state === "invalid" ? state.violations : [];
  const of = (field: ProfileViolation["field"], index?: number) =>
    violations.filter(
      (violation) =>
        violation.field === field &&
        (index === undefined ||
          ("index" in violation && violation.index === index)),
    );

  const addRow = () => {
    setRows([...rows, { id: nextId, title: "", url: "" }]);
    setNextId(nextId + 1);
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
            <li key={row.id}>
              <LinkFields
                index={index}
                row={row}
                titleViolations={of("link.title", index)}
                urlViolations={of("link.url", index)}
                onRemove={() => {
                  setRows(rows.filter((candidate) => candidate.id !== row.id));
                }}
              />
            </li>
          ))}
        </ul>

        <button type="button" onClick={addRow} className={SECONDARY_BUTTON}>
          {copy.addLink}
        </button>
      </fieldset>

      <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
        {pending ? copy.saving : copy.save}
      </button>
    </form>
  );
}

function rowsOf(draft: ProfileDraft): readonly LinkRow[] {
  return draft.links.map((link, index) => ({
    id: index,
    title: link.title,
    url: link.url,
  }));
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
}: {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly defaultValue: string;
  readonly violations: readonly ProfileViolation[];
  readonly multiline?: boolean;
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
  row,
  titleViolations,
  urlViolations,
  onRemove,
}: {
  readonly index: number;
  readonly row: LinkRow;
  readonly titleViolations: readonly ProfileViolation[];
  readonly urlViolations: readonly ProfileViolation[];
  readonly onRemove: () => void;
}) {
  const position = String(index + 1);

  return (
    <div className="space-y-3">
      <Field
        id={`profile-link-${String(index)}-title`}
        name={`link-${String(index)}-title`}
        label={copy.linkTitleLabel.replace("{position}", position)}
        defaultValue={row.title}
        violations={titleViolations}
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
