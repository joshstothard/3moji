import type { EmailSender } from "../ports/email-sender";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

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
        // The status and Resend's own message, never the API key: this string
        // ends up in logs and error trackers.
        const detail = await response.text().catch(() => "");
        throw new Error(
          `Resend rejected the request with status ${String(response.status)}. ${detail.slice(0, 200)}`,
        );
      }
    },
  };
}
