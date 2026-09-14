"use client";

import { spokenHandle } from "@template/core/browser";
import { usePathname, useRouter } from "next/navigation";
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent,
  type SyntheticEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";

import en from "../../../../packages/shared/messages/en.json";

const copy = en.HeaderSearch;

/** ADR-0012 decision 6: how long typing must pause before the island asks. */
export const SEARCH_DEBOUNCE_MS = 250;

/** Where the island asks. `app/api/search/route.ts`. */
const SEARCH_ROUTE = "/api/search";

/**
 * Below this, nothing is asked: every request counts against the client's
 * limit, and a single letter names no term and no emoji suggestion. One emoji
 * is two UTF-16 units, so a typed emoji is asked about.
 */
const MIN_QUERY_LENGTH = 2;

/** A Handle's percent-encoded path segment: `%XX` escapes and nothing else. */
const ENCODED_SEGMENT = /^(?:%[0-9A-F]{2})+$/;

/**
 * What `GET /api/search` answers, as this component reads it.
 *
 * **Declared here, not imported from `@template/core`**: it is
 * `searchHandles`'s answer, but the root entry point cannot be bundled for the
 * browser. It is a boundary too: the JSON arrives as `unknown` and
 * {@link answerFrom} checks every field. The shape is held equal to
 * `HandleSearch` at compile time in `header-search.test.tsx`.
 */
export interface SearchAnswer {
  readonly handles: readonly {
    readonly key: string;
    readonly encoded: string;
    readonly alias: string;
    readonly displayName: string | null;
  }[];
  readonly emoji: readonly {
    readonly emoji: string;
    readonly name: string;
  }[];
}

type FoundHandle = SearchAnswer["handles"][number];
type FoundEmoji = SearchAnswer["emoji"][number];

type Option =
  | { readonly kind: "handle"; readonly handle: FoundHandle }
  | { readonly kind: "emoji"; readonly emoji: FoundEmoji };

/** What the last request answered. */
type Answered =
  | { readonly state: "idle" }
  | { readonly state: "results"; readonly answer: SearchAnswer }
  | { readonly state: "rate-limited" }
  | { readonly state: "unavailable" };

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function handleFrom(value: unknown): FoundHandle | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  if (!("key" in value) || typeof value.key !== "string") return undefined;
  if (
    !("encoded" in value) ||
    typeof value.encoded !== "string" ||
    !ENCODED_SEGMENT.test(value.encoded)
  ) {
    // Not a path this route could have produced: never linked.
    return undefined;
  }
  if (!("alias" in value) || typeof value.alias !== "string") return undefined;
  if (
    !("displayName" in value) ||
    (value.displayName !== null && typeof value.displayName !== "string")
  ) {
    return undefined;
  }
  return {
    key: value.key,
    encoded: value.encoded,
    alias: value.alias,
    displayName: value.displayName,
  };
}

function emojiFrom(value: unknown): FoundEmoji | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  if (!("emoji" in value) || typeof value.emoji !== "string") return undefined;
  if (!("name" in value) || typeof value.name !== "string") return undefined;
  return { emoji: value.emoji, name: value.name };
}

/**
 * Reads the route's JSON as a {@link SearchAnswer}: every entry is checked, an
 * entry that fails is dropped, and a body that is not the shape at all is
 * `undefined`.
 */
function answerFrom(body: unknown): SearchAnswer | undefined {
  if (
    typeof body !== "object" ||
    body === null ||
    !("handles" in body) ||
    !Array.isArray(body.handles) ||
    !("emoji" in body) ||
    !Array.isArray(body.emoji)
  ) {
    return undefined;
  }
  const handles: readonly unknown[] = body.handles;
  const emoji: readonly unknown[] = body.emoji;
  return {
    handles: handles.map(handleFrom).filter(isDefined),
    emoji: emoji.map(emojiFrom).filter(isDefined),
  };
}

/** A key typed here is somebody's text, not a shortcut. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

const subscribeToNothing = () => () => undefined;

/** `true` once hydrated, `false` in the server's HTML, with no effect. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );
}

/** Keeps focus in the box when an option is pressed with a pointer. */
function keepFocus(event: MouseEvent<HTMLElement>): void {
  event.preventDefault();
}

/**
 * The header search
 * ([ADR-0012](../../../../docs/adr/0012-header-search-lists-claimed-handles-with-display-names-capped-and-rate-limited.md),
 * [#254](https://github.com/joshstothard/3moji/issues/254)): claimed Handles,
 * their owners' display names, and emoji, as you type.
 *
 * **A client island, so that no page reads a request header to draw it**, in
 * the pattern of `AccountMenu`. The server renders the same form for every
 * visitor; after a {@link SEARCH_DEBOUNCE_MS} pause in typing, this asks
 * `GET /api/search?q=`. `apps/web/eslint.config.mjs` refuses a session or
 * `next/headers` import in this file.
 *
 * **Without JavaScript it is a plain `GET` form to `/find`**, the fallback the
 * ADR keeps: Enter submits the words and `/find` looks them up on the server.
 * With JavaScript, Enter on no option still does exactly that.
 *
 * **A WAI-ARIA combobox** (the APG's list autocomplete, without automatic
 * selection). Focus stays in the box; `aria-activedescendant` names the active
 * option. Arrow keys move through the options, wrapping. Enter opens a Handle's
 * emoji path, or puts a chosen emoji in the box and searches for it. Escape
 * closes the results, then clears the box, then closes the phone panel. `/`
 * anywhere on the page — but never while typing in a field — focuses it.
 *
 * **On a phone an icon button opens it as a panel** under the header. The
 * button needs JavaScript, so it is rendered only once hydrated; the navbar's
 * `<noscript>` links to `/find` instead.
 *
 * **It decides nothing.** What matches, the caps and the order are the
 * route's; this checks the answer's shape, and a path that is not a
 * percent-encoded segment is dropped rather than linked.
 */
export function HeaderSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const hydrated = useHydrated();

  const [query, setQuery] = useState("");
  const [answered, setAnswered] = useState<Answered>({ state: "idle" });
  const [active, setActive] = useState<number | undefined>(undefined);
  /**
   * The page the results were opened on, and the page the phone panel was
   * opened on. Each is open only while that is still the current page, so a
   * navigation closes both without an effect.
   */
  const [openedOn, setOpenedOn] = useState<string | undefined>(undefined);
  const [panelOn, setPanelOn] = useState<string | undefined>(undefined);

  const inputRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const focusAfterRender = useRef(false);

  const formId = useId();
  const inputId = useId();
  const listboxId = useId();
  const handlesHeadingId = useId();
  const emojiHeadingId = useId();

  const trimmed = query.trim();
  const asking = trimmed.length >= MIN_QUERY_LENGTH;
  const panelOpen = panelOn !== undefined && panelOn === pathname;
  const popupOpen =
    openedOn !== undefined &&
    openedOn === pathname &&
    asking &&
    answered.state !== "idle";

  const answer =
    asking && answered.state === "results" ? answered.answer : undefined;
  const options: readonly Option[] =
    answer === undefined
      ? []
      : [
          ...answer.handles.map((handle): Option => ({
            kind: "handle",
            handle,
          })),
          ...answer.emoji.map((emoji): Option => ({ kind: "emoji", emoji })),
        ];
  const listboxShown = popupOpen && options.length > 0;
  const activeOption =
    listboxShown && active !== undefined ? options[active] : undefined;
  const optionId = (index: number): string =>
    `${listboxId}-option-${String(index)}`;

  // Ask after a pause in typing. A newer query aborts the older request, so a
  // slow answer can never replace a fresher one.
  useEffect(() => {
    const text = query.trim();
    if (text.length < MIN_QUERY_LENGTH) return;

    const controller = new AbortController();
    const read = async (): Promise<void> => {
      try {
        const response = await fetch(
          `${SEARCH_ROUTE}?q=${encodeURIComponent(text)}`,
          {
            cache: "no-store",
            credentials: "same-origin",
            signal: controller.signal,
          },
        );
        let next: Answered;
        if (response.status === 429) {
          next = { state: "rate-limited" };
        } else if (!response.ok) {
          next = { state: "unavailable" };
        } else {
          const parsed = answerFrom(await response.json());
          next =
            parsed === undefined
              ? { state: "unavailable" }
              : { state: "results", answer: parsed };
        }
        if (controller.signal.aborted) return;
        setAnswered(next);
        setActive(undefined);
      } catch {
        // Offline, refused, not JSON or aborted. Aborted means a newer
        // request is on its way.
        if (!controller.signal.aborted) setAnswered({ state: "unavailable" });
      }
    };

    const timer = setTimeout(() => {
      void read();
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  // Focus the box once a phone panel that was hidden has been drawn.
  useEffect(() => {
    if (!focusAfterRender.current) return;
    focusAfterRender.current = false;
    inputRef.current?.focus();
  });

  const openPanel = (): void => {
    focusAfterRender.current = true;
    setPanelOn(pathname);
    inputRef.current?.focus();
  };

  const closePanel = (): void => {
    setPanelOn(undefined);
    setOpenedOn(undefined);
    setActive(undefined);
    openerRef.current?.focus();
  };

  // `/` focuses the search from anywhere on the page.
  useEffect(() => {
    const focusOnSlash = (event: globalThis.KeyboardEvent): void => {
      if (
        event.key !== "/" ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.defaultPrevented ||
        isTypingTarget(event.target)
      ) {
        return;
      }
      event.preventDefault();
      const input = inputRef.current;
      if (input === null) return;
      // Hidden on a phone until its panel is open.
      if (input.getClientRects().length === 0 && openerRef.current !== null) {
        focusAfterRender.current = true;
        setPanelOn(pathname);
      }
      input.focus();
    };
    window.addEventListener("keydown", focusOnSlash);
    return () => {
      window.removeEventListener("keydown", focusOnSlash);
    };
  }, [pathname]);

  const choose = (option: Option): void => {
    if (option.kind === "handle") {
      setOpenedOn(undefined);
      setPanelOn(undefined);
      setActive(undefined);
      router.push(`/${option.handle.encoded}`);
      return;
    }
    setQuery(option.emoji.emoji);
    setActive(undefined);
    setOpenedOn(pathname);
    inputRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    const count = options.length;
    switch (event.key) {
      case "ArrowDown":
        if (count === 0) return;
        event.preventDefault();
        setOpenedOn(pathname);
        setActive((current) =>
          current === undefined || current >= count - 1 ? 0 : current + 1,
        );
        return;
      case "ArrowUp":
        if (count === 0) return;
        event.preventDefault();
        setOpenedOn(pathname);
        setActive((current) =>
          current === undefined || current <= 0 ? count - 1 : current - 1,
        );
        return;
      case "Enter":
        // No active option: the form submits the words to `/find`.
        if (activeOption === undefined) return;
        event.preventDefault();
        choose(activeOption);
        return;
      case "Escape":
        event.preventDefault();
        if (popupOpen) {
          setOpenedOn(undefined);
          setActive(undefined);
        } else if (query !== "") {
          setQuery("");
        } else if (panelOpen) {
          closePanel();
        }
        return;
      case "Tab":
        setOpenedOn(undefined);
        setActive(undefined);
        return;
      default:
        return;
    }
  };

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>): void => {
    // Nothing typed: nothing for `/find` to look up.
    if (trimmed === "") event.preventDefault();
  };

  const onBlur = (event: FocusEvent<HTMLFormElement>): void => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setOpenedOn(undefined);
    setActive(undefined);
  };

  const status =
    !asking || answered.state === "idle"
      ? ""
      : answered.state === "rate-limited"
        ? copy.rateLimited
        : answered.state === "unavailable"
          ? copy.unavailable
          : options.length === 0
            ? copy.noResults
            : copy.results
                .replace("{handles}", String(answer?.handles.length ?? 0))
                .replace("{emoji}", String(answer?.emoji.length ?? 0));

  const handleOptions = answer?.handles ?? [];
  const emojiOptions = answer?.emoji ?? [];

  return (
    <div className="flex min-w-0 flex-1 justify-end md:justify-center">
      {hydrated && (
        <button
          ref={openerRef}
          type="button"
          aria-controls={formId}
          aria-expanded={panelOpen}
          aria-label={copy.open}
          onClick={() => {
            if (panelOpen) {
              closePanel();
            } else {
              openPanel();
            }
          }}
          className="inline-flex size-11 items-center justify-center rounded-full text-ink hover:bg-violet-tint focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet md:hidden"
        >
          <SearchIcon />
        </button>
      )}

      <form
        id={formId}
        role="search"
        aria-label={copy.label}
        action="/find"
        method="get"
        onSubmit={onSubmit}
        onBlur={onBlur}
        className={`md:relative md:inset-auto md:z-auto md:flex md:w-full md:max-w-[620px] md:bg-transparent md:p-0 md:shadow-none ${
          panelOpen
            ? "fixed inset-x-0 top-16 z-30 flex items-center gap-2 bg-paper px-4 pt-2 pb-4 shadow-card sm:top-20"
            : "hidden"
        }`}
      >
        {/*
         * The input is the pill, so its focus ring is an outline on the
         * focused element itself: the keyboard-only journeys require one on
         * every control Tab reaches, and the header is on every page.
         */}
        <div className="relative flex w-full min-w-0 items-center text-ink">
          <span className="pointer-events-none absolute left-[18px] flex">
            <SearchIcon />
          </span>
          <label className="sr-only" htmlFor={inputId}>
            {copy.label}
          </label>
          <input
            ref={inputRef}
            id={inputId}
            name="q"
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={listboxShown}
            aria-controls={listboxShown ? listboxId : undefined}
            aria-activedescendant={
              activeOption === undefined || active === undefined
                ? undefined
                : optionId(active)
            }
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="search"
            placeholder={copy.placeholder}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpenedOn(pathname);
              setActive(undefined);
            }}
            onFocus={() => {
              setOpenedOn(pathname);
            }}
            onKeyDown={onKeyDown}
            className="h-[52px] w-full min-w-0 rounded-full border-2 border-control bg-card pr-5 pl-12 text-base text-ink placeholder:text-muted focus-visible:border-violet focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet md:pr-16"
          />
          <kbd
            aria-hidden="true"
            className="pointer-events-none absolute right-2.5 hidden rounded-lg border border-line px-2 py-0.5 font-mono text-xs text-muted md:inline"
          >
            {popupOpen ? "esc" : "/"}
          </kbd>
        </div>

        <button
          type="button"
          aria-label={copy.close}
          onClick={closePanel}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink hover:bg-violet-tint focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet md:hidden"
        >
          <CloseIcon />
        </button>

        {popupOpen && (
          <div className="absolute inset-x-4 top-full z-30 flex flex-col gap-1 rounded-card border border-line bg-card p-3 shadow-card md:inset-x-0 md:mt-3">
            {listboxShown ? (
              <div role="listbox" id={listboxId} aria-label={copy.label}>
                {handleOptions.length > 0 && (
                  <div role="group" aria-labelledby={handlesHeadingId}>
                    <div
                      id={handlesHeadingId}
                      role="presentation"
                      className="px-3.5 pt-3 pb-1.5 text-xs font-semibold tracking-[0.08em] text-muted uppercase"
                    >
                      {copy.handlesHeading}
                    </div>
                    {handleOptions.map((handle, index) => (
                      <HandleOption
                        key={handle.key}
                        id={optionId(index)}
                        handle={handle}
                        active={active === index}
                        onChoose={() => {
                          choose({ kind: "handle", handle });
                        }}
                      />
                    ))}
                  </div>
                )}
                {emojiOptions.length > 0 && (
                  <div
                    role="group"
                    aria-labelledby={emojiHeadingId}
                    className={
                      handleOptions.length > 0
                        ? "mx-3.5 mt-2 border-t border-line pt-2"
                        : ""
                    }
                  >
                    <div
                      id={emojiHeadingId}
                      role="presentation"
                      className="py-1.5 text-xs font-semibold tracking-[0.08em] text-muted uppercase"
                    >
                      {copy.emojiHeading}
                    </div>
                    <div className="flex flex-wrap gap-2.5 pt-1.5 pb-2.5">
                      {emojiOptions.map((emoji, at) => {
                        const index = handleOptions.length + at;
                        return (
                          <EmojiOption
                            key={emoji.emoji}
                            id={optionId(index)}
                            emoji={emoji}
                            active={active === index}
                            onChoose={() => {
                              choose({ kind: "emoji", emoji });
                            }}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              // The status region below announces this; here it is drawn.
              <p aria-hidden="true" className="px-3.5 py-3 text-base text-body">
                {status}
              </p>
            )}
            <div className="mt-1 flex items-center justify-between gap-4 border-t border-line px-3.5 pt-3 pb-1 text-sm text-muted">
              <span>{copy.claimedOnly}</span>
              <span
                aria-hidden="true"
                className="hidden items-center gap-2 md:inline-flex"
              >
                <kbd className="rounded-lg border border-line px-[7px] py-0.5 font-mono text-xs">
                  <ReturnIcon />
                </kbd>
                {copy.openHint}
              </span>
            </div>
          </div>
        )}
      </form>

      {/*
       * A polite live region, and deliberately not `role="status"`: the
       * header is on every page, and a page's own status message (the reset
       * forms', the claim's) must stay the one `status` on it.
       */}
      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {status}
      </p>
    </div>
  );
}

/**
 * One Handle in the results. Its accessible name is its content: the Spoken
 * Name (so three code points are not read out one at a time), the display name
 * or "No name yet", and the alias.
 */
function HandleOption({
  id,
  handle,
  active,
  onChoose,
}: {
  readonly id: string;
  readonly handle: FoundHandle;
  readonly active: boolean;
  readonly onChoose: () => void;
}) {
  const spoken = spokenHandle(Array.from(handle.key)) ?? handle.key;
  // Muted text is 4.35:1 on the violet tint, under AA, so the active row
  // draws its quieter lines in `body` instead (globals.css).
  const quiet = active ? "text-body" : "text-muted";

  return (
    // Focus stays in the combobox: the option is chosen with the pointer here
    // and with Enter there (`aria-activedescendant`), so it takes no tab stop.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events
    <div
      id={id}
      role="option"
      aria-selected={active}
      tabIndex={-1}
      onMouseDown={keepFocus}
      onClick={onChoose}
      className={`flex cursor-pointer items-center gap-4 rounded-[18px] px-3.5 py-3 ${
        active ? "bg-violet-tint" : "hover:bg-paper"
      }`}
    >
      <span
        aria-hidden="true"
        className="w-[132px] shrink-0 text-[34px] leading-none tracking-[2px]"
      >
        {handle.key}
      </span>
      <span className="sr-only">{spoken}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={`truncate text-base font-semibold ${
            handle.displayName === null ? quiet : "text-ink"
          }`}
        >
          {handle.displayName ?? copy.noName}
        </span>
        <span className={`truncate font-mono text-[13px] ${quiet}`}>
          {handle.alias}
        </span>
      </span>
      {active && <ArrowIcon />}
    </div>
  );
}

/** One emoji suggestion: choosing it searches for that emoji. */
function EmojiOption({
  id,
  emoji,
  active,
  onChoose,
}: {
  readonly id: string;
  readonly emoji: FoundEmoji;
  readonly active: boolean;
  readonly onChoose: () => void;
}) {
  return (
    // As `HandleOption`: chosen with Enter in the combobox, or the pointer.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events
    <div
      id={id}
      role="option"
      aria-selected={active}
      tabIndex={-1}
      onMouseDown={keepFocus}
      onClick={onChoose}
      className={`inline-flex h-12 cursor-pointer items-center gap-2 rounded-full border pr-4 pl-2.5 text-[15px] font-medium text-ink ${
        active ? "border-violet bg-violet-tint" : "border-line bg-paper"
      }`}
    >
      <span aria-hidden="true" className="text-[28px] leading-none">
        {emoji.emoji}
      </span>
      <span className="inline-block first-letter:uppercase">{emoji.name}</span>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-[18px] shrink-0"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

/**
 * The Return key, drawn rather than typed: a lone `↵` is a text node axe
 * cannot measure, and reports as incomplete.
 */
function ReturnIcon() {
  return (
    <svg
      aria-hidden="true"
      className="inline size-3"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M20 5v6a3 3 0 0 1-3 3H5M9 10l-4 4 4 4" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-[18px] shrink-0 text-violet"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M7 17L17 7M9 7h8v8" />
    </svg>
  );
}
