import type { Auth } from "../auth-factory";
import type {
  PasswordResetter,
  SetNewPasswordOutcome,
} from "../password-reset";

/**
 * {@link PasswordResetter} over Better Auth's `/request-password-reset` and
 * `/reset-password` ([#192](https://github.com/joshstothard/3moji/issues/192)).
 *
 * **No `redirectTo` is passed.** Better Auth would build a link to its own
 * `GET /reset-password/:token` callback, which redirects with the token in a
 * query string; `createAuth`'s `sendResetPassword` hook sends a link to our
 * own page instead, with the token as a path segment, so a `redirectTo` would
 * be a value with no effect that reads as though it has one — and would put
 * the request through `originCheck` for nothing.
 *
 * Better Auth's refusals are recognised by **reading properties, not
 * `instanceof APIError`**: `--experimental-vm-modules` runs ESM in a realm of
 * its own, where an `instanceof` check silently fails.
 */
export function createBetterAuthPasswordResetter(auth: Auth): PasswordResetter {
  return {
    request: async (email) => {
      try {
        await auth.api.requestPasswordReset({ body: { email } });
        return "accepted";
      } catch (error) {
        // The body schema (`z.email()`) refuses before any lookup, so this
        // depends on the input alone, never on whether it is registered.
        if (codeOf(error) === "VALIDATION_ERROR") return "invalid";
        throw error;
      }
    },
    reset: async (token, newPassword): Promise<SetNewPasswordOutcome> => {
      try {
        await auth.api.resetPassword({ body: { token, newPassword } });
        return { state: "reset" };
      } catch (error) {
        const outcome = refusalOf(codeOf(error));
        if (outcome === undefined) throw error;
        return outcome;
      }
    },
  };
}

function refusalOf(
  code: string | undefined,
): SetNewPasswordOutcome | undefined {
  switch (code) {
    case "INVALID_TOKEN":
    // A token whose Account has since been deleted: from the visitor's side,
    // a link that no longer works, and nothing more.
    case "USER_NOT_FOUND":
      return { state: "invalid-link" };
    case "PASSWORD_TOO_SHORT":
      return { state: "password-too-short" };
    case "PASSWORD_TOO_LONG":
      return { state: "password-too-long" };
    default:
      return undefined;
  }
}

/** Better Auth's error code, read from its `body`, narrowed from `unknown`. */
function codeOf(error: unknown): string | undefined {
  if (
    typeof error !== "object" ||
    error === null ||
    !("body" in error) ||
    typeof error.body !== "object" ||
    error.body === null ||
    !("code" in error.body)
  ) {
    return undefined;
  }
  return typeof error.body.code === "string" ? error.body.code : undefined;
}
