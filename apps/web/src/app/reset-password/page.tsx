import Link from "next/link";

import en from "../../../../../packages/shared/messages/en.json";
import { requestPasswordResetFormAction } from "../../components/password-reset-action";
import {
  resetRequestNoticeFrom,
  type ResetRequestNotice,
} from "../../components/password-reset-state";

const copy = en.PasswordReset;

interface ResetPasswordPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * What each notice says, and whether it is news or a refusal. `sent` is a
 * status, announced politely; the rest are alerts, like the sign-in form's.
 */
function messageFor(
  notice: ResetRequestNotice | undefined,
): { readonly text: string; readonly role: "status" | "alert" } | undefined {
  switch (notice) {
    case "sent":
      return { text: copy.requestSent, role: "status" };
    case "invalid":
      return { text: copy.requestInvalid, role: "alert" };
    case "rate-limited":
      return { text: copy.requestRateLimited, role: "alert" };
    case "failed":
      return { text: copy.requestFailed, role: "alert" };
    case "link-invalid":
      return { text: copy.linkInvalid, role: "alert" };
    case undefined:
      return undefined;
  }
}

/**
 * Ask for a password-reset link
 * ([#192](https://github.com/joshstothard/3moji/issues/192)).
 *
 * The page the claim-collision email links an existing owner to
 * (`CoreServices.resetRequestUrl`), and the one the sign-in page's "Forgot your
 * password?" reaches. A plain `<form>` posting to a server action, so it works
 * with no JavaScript: the answer comes back as a fresh render carrying
 * `?notice=`.
 *
 * **`sent` is said the same way for every address**, registered or not, and
 * promises only that a link is on its way *if* the address has an Account.
 */
export default async function ResetPasswordPage({
  searchParams,
}: ResetPasswordPageProps) {
  const query = await searchParams;
  const message = messageFor(resetRequestNoticeFrom(query.notice));

  return (
    <main className="max-w-md mx-auto px-4 sm:px-6 lg:px-8 py-16">
      <h1 className="text-3xl font-bold text-slate-900 mb-4 tracking-tight">
        {copy.requestHeading}
      </h1>
      <p className="mb-8 text-base text-slate-700">{copy.requestIntro}</p>

      {message !== undefined && (
        <p
          className={
            message.role === "status"
              ? "mb-6 rounded-xl bg-emerald-50 px-4 py-3 text-base text-emerald-900"
              : "mb-6 rounded-xl bg-red-50 px-4 py-3 text-base text-red-800"
          }
          role={message.role}
        >
          {message.text}
        </p>
      )}

      <form
        action={requestPasswordResetFormAction}
        className="flex flex-col gap-4"
      >
        <div className="flex flex-col gap-2">
          <label
            className="text-base font-medium text-slate-700"
            htmlFor="reset-request-email"
          >
            {copy.emailLabel}
          </label>
          <input
            autoComplete="email"
            className="rounded-xl border border-slate-500 px-4 py-3 text-base text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
            id="reset-request-email"
            name="email"
            required
            type="email"
          />
        </div>

        <button
          className="self-start rounded-xl bg-indigo-600 px-5 py-3 text-base font-semibold text-white hover:bg-indigo-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          type="submit"
        >
          {copy.requestSubmit}
        </button>
      </form>

      <p className="mt-8 text-base">
        <Link
          className="font-medium text-indigo-700 underline hover:text-indigo-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          href="/sign-in"
        >
          {copy.backToSignIn}
        </Link>
      </p>
    </main>
  );
}
