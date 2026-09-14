/**
 * What jsdom leaves out, for the Handle builder's phone layout
 * ([#263](https://github.com/joshstothard/3moji/issues/263)).
 *
 * jsdom implements neither `window.matchMedia` nor
 * `HTMLDialogElement.showModal`, and it evaluates no CSS. The builder reads the
 * first to decide whether it is on a phone, and uses the second to open the
 * claim sheet. These stand-ins give a unit test the two answers it needs and
 * nothing more: whether the phone query matches, and whether the dialog is
 * open. **Neither proves what a browser does with a modal dialog** (the top
 * layer, the inert page behind it, where focus goes), which
 * `e2e/composer.spec.ts` proves in Chromium.
 */

/** A fixed answer to every media query: the phone one matches, or nothing does. */
export function emulateViewport(kind: "phone" | "wide"): () => void {
  const had = Object.getOwnPropertyDescriptor(window, "matchMedia");
  const matchMedia = (query: string): MediaQueryList => ({
    matches: kind === "phone" && query.includes("max-width"),
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: matchMedia,
  });

  return () => {
    if (had === undefined) {
      Reflect.deleteProperty(window, "matchMedia");
    } else {
      Object.defineProperty(window, "matchMedia", had);
    }
  };
}

/**
 * `showModal` and `close` as attribute changes, with the `close` event a
 * browser fires. Idempotent, so a suite can install it in `beforeEach`.
 */
export function installDialogStandIn(): void {
  HTMLDialogElement.prototype.showModal = function showModal(
    this: HTMLDialogElement,
  ) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
}
