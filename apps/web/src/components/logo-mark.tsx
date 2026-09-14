/**
 * The 3moji logo mark: three overlapping slots, ink, violet and sunshine
 * ([#251](https://github.com/joshstothard/3moji/issues/251)).
 *
 * **Decoration, always beside the wordmark.** It is `aria-hidden`, so the link
 * or heading around it is named by the word "3moji" rather than announcing an
 * unlabelled image. The colours are SVG presentation attributes, not a
 * `style`, which the production Content Security Policy would refuse.
 */
export function LogoMark({ className }: { readonly className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      focusable="false"
      viewBox="0 0 64 40"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect fill="#1A1523" height="32" rx="9" width="28" x="1" y="4" />
      <rect
        fill="#5B3DF5"
        height="32"
        rx="9"
        stroke="#FBF8F4"
        strokeWidth="2.5"
        width="28"
        x="18"
        y="4"
      />
      <rect
        fill="#FFC53D"
        height="32"
        rx="9"
        stroke="#FBF8F4"
        strokeWidth="2.5"
        width="28"
        x="35"
        y="4"
      />
    </svg>
  );
}
