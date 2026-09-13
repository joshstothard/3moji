import type { Locator } from "@playwright/test";

/**
 * Measured colour contrast for what axe does not evaluate
 * ([#177](https://github.com/joshstothard/3moji/issues/177)).
 *
 * axe's `color-contrast` rule does not reliably evaluate `::placeholder` text,
 * and it ignores a glyph hidden from assistive technology, so a green axe run
 * says nothing about either. This measures them from the rendered page instead:
 * the colours come from `getComputedStyle` in the real browser, including the
 * pseudo-element, never from Tailwind's documented values.
 *
 * **The colours are resolved by painting them.** Chromium reports Tailwind
 * v4's palette as `oklch(…)`, not `rgb(…)`, so rather than re-implement colour
 * space conversion here, each computed colour is painted onto an sRGB canvas
 * and read back as the pixel the screen would show. The backdrop is painted the
 * same way: every ancestor's background from the canvas (white, as the
 * browser's own) inwards, so a translucent layer composites as it renders. The
 * foreground is then painted over it, which is what makes a translucent text
 * colour count at its real, blended value.
 *
 * It refuses — throws, rather than guessing — when something it cannot model
 * sits in the way: a background image or a reduced `opacity` on the element or
 * any ancestor.
 */

/** An 8-bit sRGB colour as painted, with no alpha: it is already composited. */
export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** One measurement, with everything a failing assertion needs to print. */
export interface ContrastMeasurement {
  /** The computed foreground colour exactly as the browser reported it. */
  readonly computedForeground: string;
  /** Each non-transparent backdrop layer as reported, outermost first. */
  readonly computedBackdrop: readonly string[];
  readonly foreground: Rgb;
  readonly background: Rgb;
  /** The WCAG 2 contrast ratio, from 1 to 21. */
  readonly ratio: number;
}

/**
 * The contrast of an element's text colour — or its `::placeholder`'s —
 * against what is painted behind it.
 */
export async function measureContrast(
  target: Locator,
  pseudo?: "::placeholder",
): Promise<ContrastMeasurement> {
  const painted = await target.evaluate((element, pseudoElement) => {
    const unmodelled: string[] = [];
    const layers: string[] = [];
    for (
      let node: Element | null = element;
      node !== null;
      node = node.parentElement
    ) {
      const style = getComputedStyle(node);
      if (style.backgroundImage !== "none") {
        unmodelled.push(`${node.tagName} background-image`);
      }
      if (style.opacity !== "1") {
        unmodelled.push(`${node.tagName} opacity ${style.opacity}`);
      }
      layers.unshift(style.backgroundColor);
    }

    const foregroundColour =
      pseudoElement === null
        ? getComputedStyle(element).color
        : getComputedStyle(element, pseudoElement).color;

    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { colorSpace: "srgb" });
    if (context === null) {
      return { error: "No 2D canvas context." } as const;
    }

    const pixel = (): { r: number; g: number; b: number } => {
      const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;
      return { r, g, b };
    };

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, 1, 1);
    for (const layer of layers) {
      context.fillStyle = layer;
      context.fillRect(0, 0, 1, 1);
    }
    const background = pixel();

    context.fillStyle = foregroundColour;
    context.fillRect(0, 0, 1, 1);
    const foreground = pixel();

    return {
      unmodelled,
      computedForeground: foregroundColour,
      computedBackdrop: layers.filter(
        (layer) => layer !== "rgba(0, 0, 0, 0)" && layer !== "transparent",
      ),
      foreground,
      background,
    } as const;
  }, pseudo ?? null);

  if ("error" in painted) {
    throw new Error(painted.error);
  }
  if (painted.unmodelled.length > 0) {
    throw new Error(
      `Contrast cannot be measured honestly through: ${painted.unmodelled.join(", ")}.`,
    );
  }

  return {
    computedForeground: painted.computedForeground,
    computedBackdrop: painted.computedBackdrop,
    foreground: painted.foreground,
    background: painted.background,
    ratio: contrastRatio(painted.foreground, painted.background),
  };
}

/**
 * A form field's border, measured for WCAG 1.4.11 Non-text Contrast
 * ([#182](https://github.com/joshstothard/3moji/issues/182)).
 *
 * A border sits between two surfaces: the one behind the field and the field's
 * own fill. Both are measured and **the lower ratio is the one that counts**,
 * so the check never rests on a reading of which side is "adjacent".
 */
export interface BorderContrastMeasurement {
  /** The computed `border-color`, exactly as the browser reported it. */
  readonly computedBorder: string;
  /** The computed `border-width`, e.g. `1px`. */
  readonly borderWidth: string;
  /** The border as painted, over the fill and the surface behind the field. */
  readonly border: Rgb;
  /** Every ancestor's background, composited: the surface around the field. */
  readonly surface: Rgb;
  /** The field's own background over that surface. */
  readonly fill: Rgb;
  readonly againstSurface: number;
  readonly againstFill: number;
  /** The lower of the two. */
  readonly ratio: number;
}

/**
 * The contrast of an element's border against the surface around it and
 * against its own fill, painted the same way as {@link measureContrast}.
 *
 * It refuses, as that does, a background image or reduced `opacity` anywhere
 * on the way down. It also refuses **a border that is not drawn** — a style of
 * `none` or `hidden`, or no width — and one whose four sides differ, because
 * `getComputedStyle` reports a `border-color` either way, and a check that
 * measured an edge nobody can see would go green for nothing.
 */
export async function measureBorderContrast(
  target: Locator,
): Promise<BorderContrastMeasurement> {
  const painted = await target.evaluate((element) => {
    const unmodelled: string[] = [];
    const outside: string[] = [];
    for (
      let node: Element | null = element;
      node !== null;
      node = node.parentElement
    ) {
      const style = getComputedStyle(node);
      if (style.backgroundImage !== "none") {
        unmodelled.push(`${node.tagName} background-image`);
      }
      if (style.opacity !== "1") {
        unmodelled.push(`${node.tagName} opacity ${style.opacity}`);
      }
      if (node !== element) {
        outside.unshift(style.backgroundColor);
      }
    }

    const style = getComputedStyle(element);
    const sides = ["Top", "Right", "Bottom", "Left"] as const;
    const edges = sides.map((side) => ({
      style: style.getPropertyValue(`border-${side.toLowerCase()}-style`),
      width: style.getPropertyValue(`border-${side.toLowerCase()}-width`),
      colour: style.getPropertyValue(`border-${side.toLowerCase()}-color`),
    }));
    const [top] = edges;
    if (top === undefined) {
      return { error: "No border edges to read." } as const;
    }
    if (
      edges.some(
        (edge) =>
          edge.style !== top.style ||
          edge.width !== top.width ||
          edge.colour !== top.colour,
      )
    ) {
      unmodelled.push("a border whose four sides differ");
    }
    if (
      top.style === "none" ||
      top.style === "hidden" ||
      Number.parseFloat(top.width) <= 0
    ) {
      unmodelled.push(`a border that is not drawn (${top.style} ${top.width})`);
    }

    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { colorSpace: "srgb" });
    if (context === null) {
      return { error: "No 2D canvas context." } as const;
    }

    const paint = (layers: readonly string[]) => {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, 1, 1);
      for (const layer of layers) {
        context.fillStyle = layer;
        context.fillRect(0, 0, 1, 1);
      }
      const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;
      return { r, g, b };
    };

    return {
      unmodelled,
      computedBorder: top.colour,
      borderWidth: top.width,
      surface: paint(outside),
      fill: paint([...outside, style.backgroundColor]),
      // The background is clipped to the border box by default, so the border
      // is painted over the field's own fill.
      border: paint([...outside, style.backgroundColor, top.colour]),
    } as const;
  });

  if ("error" in painted) {
    throw new Error(painted.error);
  }
  if (painted.unmodelled.length > 0) {
    throw new Error(
      `Contrast cannot be measured honestly through: ${painted.unmodelled.join(", ")}.`,
    );
  }

  const againstSurface = contrastRatio(painted.border, painted.surface);
  const againstFill = contrastRatio(painted.border, painted.fill);
  return {
    computedBorder: painted.computedBorder,
    borderWidth: painted.borderWidth,
    border: painted.border,
    surface: painted.surface,
    fill: painted.fill,
    againstSurface,
    againstFill,
    ratio: Math.min(againstSurface, againstFill),
  };
}

/** A one-line account of a border measurement, for an assertion and the log. */
export function describeBorderContrast(
  subject: string,
  measurement: BorderContrastMeasurement,
): string {
  return `${subject}: border ${measurement.computedBorder} ${measurement.borderWidth} (${hex(measurement.border)}) = ${measurement.againstSurface.toFixed(2)}:1 against the surface (${hex(measurement.surface)}), ${measurement.againstFill.toFixed(2)}:1 against its fill (${hex(measurement.fill)})`;
}

function hex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

/** WCAG 2 relative luminance of an 8-bit sRGB colour. */
function relativeLuminance({ r, g, b }: Rgb): number {
  const linear = (channel: number): number => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** The WCAG 2 contrast ratio between two opaque colours. */
export function contrastRatio(first: Rgb, second: Rgb): number {
  const [lighter, darker] = [
    relativeLuminance(first),
    relativeLuminance(second),
  ].sort((a, b) => b - a) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}

/** A one-line account of a measurement, for an assertion message and the log. */
export function describeContrast(
  subject: string,
  measurement: ContrastMeasurement,
): string {
  return `${subject}: ${measurement.computedForeground} (${hex(measurement.foreground)}) on ${measurement.computedBackdrop.join(" > ") || "the canvas"} (${hex(measurement.background)}) = ${measurement.ratio.toFixed(2)}:1`;
}
