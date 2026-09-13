import { notFound, permanentRedirect, redirect } from "next/navigation";
import { canonicalise, spokenHandle } from "@template/core";

import {
  readEditableDraft,
  readEditAuthority,
} from "../../../lib/profile-edit";
import { ProfileForm } from "../../../components/profile-form";
import { saveProfileAction } from "../../../components/profile-edit-action";
import en from "../../../../../../packages/shared/messages/en.json";

const copy = en.ProfileEdit;

interface EditProfilePageProps {
  readonly params: Promise<{ readonly handle: string }>;
}

/**
 * The owner's edit surface: `3moji.me/🧊🧊🧊/edit`.
 *
 * **The same canonicalisation discipline as the page it edits.** A route that
 * skipped it would be reachable at spellings `/[handle]` redirects away from,
 * and the Handle the authority check compares would be one of those spellings
 * rather than the canonical key.
 *
 * **The guard here is the second layer, not the only one.** A page can only
 * withhold a form; `saveProfileAction` is a public endpoint and enforces the
 * same rule itself, because "the form was never rendered for them" protects
 * nothing against a direct POST. `docs/development/engineering-standards.md`
 * § Security asks for exactly this — access control at more than one layer,
 * where a defect in either does not by itself leak.
 *
 * **A refusal is a 404, with one exception.** Somebody who is not signed in is
 * sent to sign in, because that is a problem they can fix and the request tells
 * us nothing about them. Every other refusal — the wrong Handle, an unfinished
 * Claim, no Handle at all — answers `notFound`, which says nothing about
 * whether the Handle exists, who owns it, or which of those was the reason.
 */
export default async function EditProfilePage({
  params,
}: EditProfilePageProps) {
  const { handle } = await params;
  const result = canonicalise(handle);

  if (!result.ok) notFound();
  if (!result.isCanonical) permanentRedirect(`/${result.encoded}/edit`);

  const authority = await readEditAuthority(result.encoded);

  if (authority.state === "signed-out") redirect("/sign-in");
  if (authority.state !== "allowed") notFound();

  const draft = await readEditableDraft(result.encoded);
  const spoken = spokenHandle(result.emoji.map((entry) => entry.emoji));

  return (
    <main className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
      <h1 className="text-4xl sm:text-5xl tracking-tight text-center">
        <span role="img" aria-label={spoken ?? result.key}>
          {result.key}
        </span>
      </h1>
      <p className="mt-4 text-center text-lg text-slate-500">{copy.heading}</p>

      {draft === undefined ? (
        /*
         * The Profile could not be read, so the form is **not** rendered.
         * Showing empty fields here would invite an owner to save them over a
         * Profile we simply failed to load — the one failure on this page that
         * destroys somebody's content rather than merely frustrating them.
         */
        <p role="alert" className="mt-10 text-lg text-rose-800">
          {copy.unreadable}
        </p>
      ) : (
        <ProfileForm
          handle={result.encoded}
          initial={draft}
          save={saveProfileAction}
        />
      )}
    </main>
  );
}
