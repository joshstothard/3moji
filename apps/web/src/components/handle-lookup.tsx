import en from "../../../../packages/shared/messages/en.json";

const copy = en.HandleLookup;

const HEADING_ID = "handle-lookup-heading";
const FIELD_ID = "handle-lookup-words";
const HINT_ID = "handle-lookup-hint";

/**
 * "Find a Handle": somewhere to type the words you heard
 * ([#200](https://github.com/joshstothard/3moji/issues/200)).
 *
 * The builder beside it makes a Handle to claim; this looks one up, which
 * ADR-0008 calls the product's founding use case.
 *
 * **A plain `GET` form and nothing else** — no client component, no state, no
 * handler. The browser submits `/find?q=…` itself, so it works with JavaScript
 * disabled, and `/find` does the rest on the server through `resolveAlias`.
 * `GET` rather than a server action because a lookup changes nothing, and the
 * answer is a URL a visitor can keep.
 *
 * **The form is the `search` landmark**, named by its visible heading. The
 * wrapper is a plain `<div>` rather than a labelled `<section>`, so the page
 * does not gain two landmarks with the same name.
 *
 * The field's border is `control`, like every text field here: it is the only
 * cue that identifies the field on paper, so it has to meet WCAG 1.4.11's 3:1
 * ([#182](https://github.com/joshstothard/3moji/issues/182)), and the brand's
 * lighter control border does not (#251).
 */
export function HandleLookup({
  defaultValue,
}: {
  /** The words a visitor already tried, when the lookup is shown again. */
  readonly defaultValue?: string | undefined;
}) {
  return (
    <div className="mt-12">
      <h2
        className="text-[13px] font-semibold text-muted uppercase tracking-[0.08em]"
        id={HEADING_ID}
      >
        {copy.heading}
      </h2>
      <form
        action="/find"
        aria-labelledby={HEADING_ID}
        className="mt-4 flex flex-wrap items-end gap-2"
        method="get"
        role="search"
      >
        <div className="flex w-full max-w-sm flex-col gap-1">
          <label className="text-sm text-body" htmlFor={FIELD_ID}>
            {copy.label}
          </label>
          <input
            aria-describedby={HINT_ID}
            autoCapitalize="none"
            autoComplete="off"
            className="min-h-11 rounded-full bg-card border border-control px-5 text-[15px] text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet"
            defaultValue={defaultValue}
            id={FIELD_ID}
            name="q"
            required
            spellCheck={false}
            type="search"
          />
        </div>
        <button
          className="min-h-11 rounded-full bg-violet px-5 text-[15px] font-semibold text-white hover:bg-violet-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet"
          type="submit"
        >
          {copy.submit}
        </button>
      </form>
      <p className="mt-2 text-sm text-muted" id={HINT_ID}>
        {copy.hint}
      </p>
    </div>
  );
}
