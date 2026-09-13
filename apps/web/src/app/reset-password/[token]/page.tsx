import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@template/core";
import type { Metadata } from "next";
import Link from "next/link";

import en from "../../../../../../packages/shared/messages/en.json";
import { setNewPasswordFormAction } from "../../../components/password-reset-action";
import {
  setNewPasswordErrorFrom,
  type SetNewPasswordError,
} from "../../../components/password-reset-state";

const copy = en.PasswordReset;

/**
 * **The token is in this page's address**, so nothing on it may carry the
 * address to another site: `same-origin` sends no referrer on any cross-origin
 * request, and the page is not indexed.
 *
 * **Not `no-referrer`.** With it, the form's own POST was refused by Next.js
 * as `Invalid Server Actions request` when run with JavaScript off, breaking
 * the form outright; `same-origin` fixes it (#192). The likely cause is the
 * request's `Origin` failing Next.js's server-action origin check — likely,
 * not measured.
 */
export const metadata: Metadata = {
  referrer: "same-origin",
  robots: { index: false, follow: false },
};

interface SetNewPasswordPageProps {
  readonly params: Promise<{ readonly token: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function withLengths(text: string): string {
  return text
    .replace("{min}", String(PASSWORD_MIN_LENGTH))
    .replace("{max}", String(PASSWORD_MAX_LENGTH));
}

function errorFor(error: SetNewPasswordError | undefined): string | undefined {
  switch (error) {
    case "too-short":
      return withLengths(copy.setTooShort);
    case "too-long":
      return withLengths(copy.setTooLong);
    case "failed":
      return copy.setFailed;
    case undefined:
      return undefined;
  }
}

/**
 * Set a new password, from the link a reset email carries
 * ([#192](https://github.com/joshstothard/3moji/issues/192)).
 *
 * The link is `/reset-password/<token>`: `createAuth` rewrites Better Auth's own
 * callback link to this page, and **the token stays a path segment**, never a
 * query parameter (`docs/architecture/auth.md`).
 *
 * **The token is not checked when the page renders.** It is checked, and
 * consumed, when the form is submitted — by `auth.api.resetPassword`, which
 * also checks its expiry — and an invalid, used or expired one sends the
 * visitor to the request form with one message for all three. Checking here
 * too would add a database read to every render and a second place the answer
 * could disagree with the one that counts.
 *
 * A plain `<form>` posting to a server action, so it works without JavaScript.
 */
export default async function SetNewPasswordPage({
  params,
  searchParams,
}: SetNewPasswordPageProps) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  const error = errorFor(setNewPasswordErrorFrom(query.error));

  return (
    <main className="max-w-md mx-auto px-4 sm:px-6 lg:px-8 py-16">
      <h1 className="text-3xl font-bold text-slate-900 mb-8 tracking-tight">
        {copy.setHeading}
      </h1>

      {error !== undefined && (
        <p
          className="mb-6 rounded-xl bg-red-50 px-4 py-3 text-base text-red-800"
          role="alert"
        >
          {error}
        </p>
      )}

      <form action={setNewPasswordFormAction} className="flex flex-col gap-4">
        <input name="token" type="hidden" value={token} />

        <div className="flex flex-col gap-2">
          <label
            className="text-base font-medium text-slate-700"
            htmlFor="reset-new-password"
          >
            {copy.newPasswordLabel}
          </label>
          <input
            aria-describedby="reset-new-password-hint"
            autoComplete="new-password"
            className="rounded-xl border border-slate-500 px-4 py-3 text-base text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
            id="reset-new-password"
            maxLength={PASSWORD_MAX_LENGTH}
            minLength={PASSWORD_MIN_LENGTH}
            name="password"
            required
            type="password"
          />
          <p className="text-base text-slate-700" id="reset-new-password-hint">
            {withLengths(copy.newPasswordHint)}
          </p>
        </div>

        <button
          className="self-start rounded-xl bg-indigo-600 px-5 py-3 text-base font-semibold text-white hover:bg-indigo-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          type="submit"
        >
          {copy.setSubmit}
        </button>
      </form>

      <p className="mt-8 text-base">
        <Link
          className="font-medium text-indigo-700 underline hover:text-indigo-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          href="/sign-in"
        >
          {en.PasswordReset.backToSignIn}
        </Link>
      </p>
    </main>
  );
}
