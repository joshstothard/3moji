import { Fragment, type ReactNode } from "react";

/**
 * A sentence from `en.json` with links in the middle of it
 * ([#198](https://github.com/joshstothard/3moji/issues/198)).
 *
 * The copy keeps the whole sentence, with `{token}` where a link goes, so a
 * translation can move the link rather than having to split the sentence into
 * fragments. Each token is replaced by the node given for it; a token with no
 * node is left as written, which a test would notice.
 *
 * No `"use client"` and no hooks, so a server component and a client component
 * can both use it.
 */
export function LinkedSentence({
  text,
  links,
}: {
  readonly text: string;
  readonly links: Readonly<Record<string, ReactNode>>;
}) {
  const parts = text.split(/(\{\w+\})/);

  return (
    <>
      {parts.map((part, index) => {
        const token = /^\{(\w+)\}$/.exec(part)?.[1];
        const node = token === undefined ? undefined : links[token];
        return (
          // The parts of one fixed sentence never reorder, so the index is a
          // stable key.
          <Fragment key={index}>{node ?? part}</Fragment>
        );
      })}
    </>
  );
}
