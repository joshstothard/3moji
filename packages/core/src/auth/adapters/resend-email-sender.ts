import type { EmailSender } from "../ports/email-sender";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/**
 * The error `name`s Resend documents for its REST API, as upper-case codes.
 *
 * An allow-list rather than a pattern because the value is copied out of a
 * third party's response body: only a member of this list is ever admitted,
 * and what the error carries is the **literal from this list**, never the
 * body's own string. Resend spells one of them `invalid_api_Key`, which is why
 * the comparison is case-insensitive.
 */
const RESEND_ERROR_CODES = [
  "APPLICATION_ERROR",
  "CONCURRENT_IDEMPOTENT_REQUESTS",
  "DAILY_QUOTA_EXCEEDED",
  "INTERNAL_SERVER_ERROR",
  "INVALID_ACCESS",
  "INVALID_API_KEY",
  "INVALID_ATTACHMENT",
  "INVALID_FROM_ADDRESS",
  "INVALID_IDEMPOTENCY_KEY",
  "INVALID_IDEMPOTENT_REQUEST",
  "INVALID_PARAMETER",
  "INVALID_REGION",
  "METHOD_NOT_ALLOWED",
  "MISSING_API_KEY",
  "MISSING_REQUIRED_FIELD",
  "MONTHLY_QUOTA_EXCEEDED",
  "NOT_FOUND",
  "RATE_LIMIT_EXCEEDED",
  "RESTRICTED_API_KEY",
  "SECURITY_ERROR",
  "VALIDATION_ERROR",
] as const;

/**
 * Resend's error type as a stable code, e.g. `VALIDATION_ERROR`, or
 * `UNRECOGNISED` when the body was not Resend's JSON or named a type outside
 * {@link RESEND_ERROR_CODES}. Upper-case so it matches the `code` shape
 * `apps/web`'s log descriptor admits (`/^[A-Z0-9_]{1,64}$/`).
 */
export type ResendErrorCode =
  (typeof RESEND_ERROR_CODES)[number] | "UNRECOGNISED";

/**
 * Resend answered with a non-2xx status.
 *
 * **Carries no text from Resend's response body, by construction** (#140). A
 * rejection body can quote the request it rejected — the recipient's address
 * among it — and an error tracker captures `message` and the `cause` chain by
 * default. So the message is built only from the numeric status and a code
 * chosen from a fixed list, and there is no `cause`.
 *
 * `status` and `code` are properties so a consumer reads them directly rather
 * than parsing the message; the message still says `status NNN` for one that
 * reads only text.
 */
export class ResendRequestRejected extends Error {
  readonly status: number;
  readonly code: ResendErrorCode;

  constructor(status: number, code: ResendErrorCode) {
    super(
      `Resend rejected the request with status ${String(status)} (${code}).`,
    );
    this.name = "ResendRequestRejected";
    this.status = status;
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The allow-listed code for a rejection body. Never returns body text. */
function resendErrorCodeOf(body: string): ResendErrorCode {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return "UNRECOGNISED";
  }
  const name = isRecord(parsed) ? parsed.name : undefined;
  if (typeof name !== "string") return "UNRECOGNISED";
  const wanted = name.toUpperCase();
  return (
    RESEND_ERROR_CODES.find((candidate) => candidate === wanted) ??
    "UNRECOGNISED"
  );
}

export interface ResendEmailSenderInput {
  /** Resend API key. Passed in; never read from the environment here. */
  readonly apiKey: string;
  /** The verified sender, e.g. `3moji <no-reply@mail.3moji.me>`. */
  readonly from: string;
  /** Injected for testing; defaults to the global `fetch`. */
  readonly fetch?: typeof fetch;
}

/**
 * Sends through Resend's REST API.
 *
 * Deliberately uses `fetch` rather than Resend's SDK: this package must stay
 * free of avoidable dependencies, the request is one POST, and an injected
 * `fetch` is far easier to assert against than a mocked client.
 *
 * A rejection throws {@link ResendRequestRejected}. A network failure is the
 * `fetch` rejection itself, passed through unchanged: it is raised before any
 * response exists, and its message and `cause` name the endpoint and a system
 * code such as `ECONNREFUSED`, not anything about the email.
 */
export function createResendEmailSender(
  input: ResendEmailSenderInput,
): EmailSender {
  if (input.apiKey === "") {
    throw new Error(
      "createResendEmailSender requires an API key. Pass the value of RESEND_API_KEY rather than an empty string.",
    );
  }

  const doFetch = input.fetch ?? fetch;

  return {
    send: async (email) => {
      const response = await doFetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: input.from,
          to: [email.to],
          subject: email.subject,
          text: email.text,
        }),
      });

      if (!response.ok) {
        // The body is read only to pick a code from the allow-list. None of
        // it reaches the error: it can quote the recipient's address.
        const body = await response.text().catch(() => "");
        throw new ResendRequestRejected(
          response.status,
          resendErrorCodeOf(body),
        );
      }
    },
  };
}
