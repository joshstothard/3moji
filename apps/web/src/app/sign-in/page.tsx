import Link from "next/link";

import en from "../../../../../packages/shared/messages/en.json";
import { signInFormAction } from "../../components/sign-in-action";

const copy = en.Claim;
const resetCopy = en.PasswordReset;

/**
 * Sign in.
 *
 * **Deliberately minimal, and here for one reason:** #82's acceptance criterion
 * is that signing in before verifying renders the hold screen with a resend
 * action rather than an error, and a criterion about a form needs a form.
 * `signInAction` holds that behaviour — the 403 Better Auth returns for an
 * unverified Account becomes a redirect to that person's own hold screen.
 *
 * "Forgot your password?" goes to the reset request form (#192). There is no
 * sign-up link: sign-up happens inside the Claim rather than on its own
 * (ADR-0004 decision 4), and a dead link would be worse than none.
 *
 * A plain `<form>` posting to a server action, so it works with no JavaScript:
 * a refusal comes back as a fresh render carrying `?error=`, announced by a
 * live region because a sighted user sees it appear and a screen-reader user
 * would otherwise be told nothing at all.
 */
interface SignInPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Whitelisted, because a query string is public input that lands in copy. */
function errorFor(value: string | string[] | undefined): string | undefined {
  const candidate = typeof value === "string" ? value : value?.[0];
  if (candidate === "invalid") return copy.signInInvalid;
  if (candidate === "failed") return copy.signInFailed;
  // Announced by the same live region as the other refusals, with no focus
  // moved: a fresh render of the form, like them (#180).
  if (candidate === "rate-limited") return copy.signInRateLimited;
  return undefined;
}

/**
 * News rather than a refusal, so a polite `role="status"`: a password was just
 * reset (#192), which also signed this browser out.
 */
function noticeFor(value: string | string[] | undefined): string | undefined {
  const candidate = typeof value === "string" ? value : value?.[0];
  if (candidate === "password-reset") return resetCopy.resetDone;
  return undefined;
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const query = await searchParams;
  const error = errorFor(query.error);
  const notice = noticeFor(query.notice);

  return (
    <main className="max-w-md mx-auto px-4 sm:px-6 lg:px-8 py-16">
      <h1 className="text-3xl font-bold text-ink mb-8 tracking-tight">
        {copy.signInHeading}
      </h1>

      {notice !== undefined && (
        <p
          className="mb-6 rounded-2xl bg-emerald-50 px-4 py-3 text-base text-emerald-900"
          role="status"
        >
          {notice}
        </p>
      )}

      {error !== undefined && (
        <p
          className="mb-6 rounded-2xl bg-red-50 px-4 py-3 text-base text-red-800"
          role="alert"
        >
          {error}
        </p>
      )}

      <form action={signInFormAction} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label
            className="text-base font-medium text-body"
            htmlFor="sign-in-email"
          >
            {copy.signInEmailLabel}
          </label>
          <input
            autoComplete="email"
            className="rounded-2xl border border-control px-4 py-3 text-base text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet"
            id="sign-in-email"
            name="email"
            required
            type="email"
          />
        </div>

        <div className="flex flex-col gap-2">
          <label
            className="text-base font-medium text-body"
            htmlFor="sign-in-password"
          >
            {copy.signInPasswordLabel}
          </label>
          <input
            autoComplete="current-password"
            className="rounded-2xl border border-control px-4 py-3 text-base text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet"
            id="sign-in-password"
            name="password"
            required
            type="password"
          />
        </div>

        <button
          className="self-start rounded-full bg-violet px-5 py-3 text-base font-semibold text-white hover:bg-violet-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet"
          type="submit"
        >
          {copy.signInSubmit}
        </button>
      </form>

      <p className="mt-8 text-base">
        <Link
          className="font-medium text-violet underline hover:text-violet-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet"
          href="/reset-password"
        >
          {resetCopy.forgotPasswordLink}
        </Link>
      </p>
    </main>
  );
}
