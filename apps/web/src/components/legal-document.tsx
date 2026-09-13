import Link from "next/link";

import en from "../../../../packages/shared/messages/en.json";

/**
 * The shape shared by the privacy notice and the terms of use
 * ([#196](https://github.com/joshstothard/3moji/issues/196)).
 *
 * Both are drafts written by the agent for the owner to review, so both carry
 * the same visible draft marker. It lives here, once: removing it is one edit
 * to {@link DraftMarker}, not one per page.
 *
 * All copy is in the `Legal` namespace of `packages/shared/messages/en.json`.
 * Anything that would identify the operator is a bracketed placeholder there,
 * substituted for the `{operator}` and `{contact}` tokens; nothing personal is
 * written in this file.
 */
const legal = en.Legal;

export interface LegalSection {
  readonly heading: string;
  readonly paragraphs: readonly string[];
  readonly items?: readonly string[];
  readonly closing?: readonly string[];
}

export interface LegalDocumentProps {
  readonly heading: string;
  readonly intro: string;
  readonly sections: Readonly<Record<string, LegalSection>>;
  readonly related: { readonly href: string; readonly label: string };
}

/** Replaces the operator tokens with the owner's placeholders. */
export function fillPlaceholders(text: string): string {
  return text
    .replaceAll("{operator}", legal.operatorPlaceholder)
    .replaceAll("{contact}", legal.contactPlaceholder);
}

/** "Draft — pending owner review", until the owner removes it. */
export function DraftMarker() {
  return (
    <div className="mb-8 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
      <p className="text-base font-semibold text-amber-900">
        {legal.draftMarker}
      </p>
      <p className="mt-1 text-sm text-amber-900">{legal.draftExplainer}</p>
    </div>
  );
}

function Paragraphs({ texts }: { readonly texts: readonly string[] }) {
  return (
    <>
      {texts.map((text) => (
        <p className="mt-3 text-base leading-7 text-slate-700" key={text}>
          {fillPlaceholders(text)}
        </p>
      ))}
    </>
  );
}

export function LegalDocument({
  heading,
  intro,
  sections,
  related,
}: LegalDocumentProps) {
  return (
    <main className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
      <h1 className="text-3xl font-bold text-slate-900 mb-6 tracking-tight">
        {heading}
      </h1>

      <DraftMarker />

      <p className="text-lg leading-8 text-slate-700">{intro}</p>

      {Object.entries(sections).map(([id, section]) => (
        <section aria-labelledby={`legal-${id}`} className="mt-10" key={id}>
          <h2
            className="text-xl font-semibold text-slate-900"
            id={`legal-${id}`}
          >
            {section.heading}
          </h2>
          <Paragraphs texts={section.paragraphs} />
          {section.items !== undefined && (
            <ul className="mt-3 list-disc space-y-2 pl-6 text-base leading-7 text-slate-700">
              {section.items.map((item) => (
                <li key={item}>{fillPlaceholders(item)}</li>
              ))}
            </ul>
          )}
          {section.closing !== undefined && (
            <Paragraphs texts={section.closing} />
          )}
        </section>
      ))}

      <p className="mt-12">
        <Link
          className="inline-flex min-h-11 items-center text-base font-semibold text-indigo-700 underline hover:text-indigo-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          href={related.href}
        >
          {related.label}
        </Link>
      </p>
    </main>
  );
}
