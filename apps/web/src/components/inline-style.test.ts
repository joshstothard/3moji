import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * No component sets an inline style
 * ([#267](https://github.com/joshstothard/3moji/issues/267)).
 *
 * The production Content Security Policy allows no `'unsafe-inline'` in
 * `style-src`, so a `style` attribute in server-rendered HTML is refused. React
 * sets a `style` prop through the CSSOM after hydration, which the policy does
 * not govern, but the same prop is an attribute in the HTML the server sends:
 * the rare three-of-a-kind hop on an unclaimed `/[handle]` rendered one. Motion
 * and layout go through classes instead.
 *
 * A source scan rather than a render, so a component no test happens to render
 * in the offending state is caught as well.
 */
describe("the components' markup", () => {
  it("sets no inline style, which the production policy refuses", () => {
    const directory = __dirname;
    const offenders = readdirSync(directory)
      .filter((name) => name.endsWith(".tsx") && !name.includes(".test."))
      .filter((name) =>
        /\bstyle=\{/.test(readFileSync(join(directory, name), "utf8")),
      );

    expect(offenders).toEqual([]);
  });
});
