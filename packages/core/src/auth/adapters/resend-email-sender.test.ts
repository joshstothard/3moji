import { createResendEmailSender } from "./resend-email-sender";

const EMAIL = {
  to: "someone@example.com",
  subject: "Verify your email",
  text: "http://localhost:3000/verify?token=abc",
  html: '<!doctype html><html lang="en"><p><a href="http://localhost:3000/verify?token=abc">Verify</a></p></html>',
} as const;

interface RecordedCall {
  readonly url: string;
  readonly method: string | undefined;
  readonly headers: Headers;
  readonly body: string;
}

function recordingFetch(response: () => Response): {
  fetch: typeof fetch;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const fake: typeof fetch = (target, init) => {
    calls.push({
      // The adapter always passes a string literal. Capturing only that keeps
      // this free of DOM types, which this package's tsconfig does not include;
      // if it ever passed something else the URL assertion fails loudly.
      url: typeof target === "string" ? target : "",
      method: init?.method,
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? init.body : "",
    });
    return Promise.resolve(response());
  };
  return { fetch: fake, calls };
}

describe("createResendEmailSender", () => {
  it("posts the email to Resend with the configured sender", async () => {
    const { fetch: fake, calls } = recordingFetch(
      () => new Response(JSON.stringify({ id: "re_123" }), { status: 200 }),
    );

    const sender = createResendEmailSender({
      apiKey: "re_test_key",
      from: "3moji <no-reply@mail.3moji.me>",
      fetch: fake,
    });

    await sender.send(EMAIL);

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.url).toBe("https://api.resend.com/emails");
    expect(call?.method).toBe("POST");
    expect(call?.headers.get("authorization")).toBe("Bearer re_test_key");
    expect(call?.headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(call?.body ?? "")).toEqual({
      from: "3moji <no-reply@mail.3moji.me>",
      to: [EMAIL.to],
      subject: EMAIL.subject,
      text: EMAIL.text,
      // Both parts, so the email is multipart (#240).
      html: EMAIL.html,
    });
  });

  it("throws when Resend rejects the request, including the status", async () => {
    const { fetch: fake } = recordingFetch(
      () =>
        new Response(JSON.stringify({ message: "domain not verified" }), {
          status: 403,
        }),
    );

    const sender = createResendEmailSender({
      apiKey: "re_test_key",
      from: "3moji <no-reply@mail.3moji.me>",
      fetch: fake,
    });

    await expect(sender.send(EMAIL)).rejects.toThrow(/403/);
  });

  it("never puts the API key in the error it throws", async () => {
    const { fetch: fake } = recordingFetch(
      () => new Response("nope", { status: 500 }),
    );

    const sender = createResendEmailSender({
      apiKey: "re_super_secret_key",
      from: "3moji <no-reply@mail.3moji.me>",
      fetch: fake,
    });

    // This string reaches logs and error trackers, so it must not carry a key.
    const thrown: unknown = await sender
      .send(EMAIL)
      .then(() => undefined)
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).not.toContain("re_super_secret_key");
    expect((thrown as Error).message).toContain("500");
  });

  describe("keeps Resend's response text out of the error it throws (#140)", () => {
    const PASSWORD = "hunter2-Tr0ub4dor&3";

    /** Resend's error shape, quoting the personal data a rejection can carry. */
    function hostileRejection(status: number, name: string): Response {
      return new Response(
        JSON.stringify({
          statusCode: status,
          name,
          message: `Invalid \`to\` field ${EMAIL.to}. Received password ${PASSWORD}.`,
        }),
        { status, headers: { "content-type": "application/json" } },
      );
    }

    async function rejectionOf(response: Response): Promise<unknown> {
      const { fetch: fake } = recordingFetch(() => response);
      const sender = createResendEmailSender({
        apiKey: "re_test_key",
        from: "3moji <no-reply@mail.3moji.me>",
        fetch: fake,
      });
      return sender
        .send(EMAIL)
        .then(() => undefined)
        .catch((error: unknown) => error);
    }

    /**
     * Every rendering an error tracker could capture: each link's `message`,
     * its `String()` and its `JSON.stringify`, all the way down `cause`.
     *
     * `JSON.stringify` of a bare `Error` is `{}`, so that rendering proves
     * nothing on its own — it becomes evidence only once the error has own
     * enumerable properties. `message` and the `cause` walk carry the
     * requirement.
     */
    function renderingsOf(thrown: unknown): string[] {
      const renderings: string[] = [];
      const seen: unknown[] = [];
      let current: unknown = thrown;
      while (
        typeof current === "object" &&
        current !== null &&
        !seen.includes(current)
      ) {
        seen.push(current);
        if ("message" in current && typeof current.message === "string") {
          renderings.push(current.message);
        }
        // `Error.prototype.toString` is what `String(error)` renders, called
        // directly so it also works on an error from another realm.
        renderings.push(
          Error.prototype.toString.call(current),
          JSON.stringify(current),
        );
        current = "cause" in current ? current.cause : undefined;
      }
      if (typeof current === "string") renderings.push(current);
      return renderings;
    }

    it.each([
      [401, "invalid_api_Key"],
      [403, "validation_error"],
      [422, "validation_error"],
      [429, "rate_limit_exceeded"],
      [500, "application_error"],
    ])(
      "never carries a recipient address or password from a %i rejection body",
      async (status, name) => {
        const thrown = await rejectionOf(hostileRejection(status, name));

        expect(typeof thrown).toBe("object");
        for (const rendering of renderingsOf(thrown)) {
          expect(rendering).not.toContain(EMAIL.to);
          expect(rendering).not.toContain(PASSWORD);
        }
      },
    );

    it("never carries text from a body that is not Resend's JSON", async () => {
      const thrown = await rejectionOf(
        new Response(`<html>upstream said ${EMAIL.to} ${PASSWORD}</html>`, {
          status: 502,
        }),
      );

      expect(typeof thrown).toBe("object");
      for (const rendering of renderingsOf(thrown)) {
        expect(rendering).not.toContain(EMAIL.to);
        expect(rendering).not.toContain(PASSWORD);
      }
    });

    it.each([
      [401, "invalid_api_Key", "INVALID_API_KEY"],
      [403, "validation_error", "VALIDATION_ERROR"],
      [422, "validation_error", "VALIDATION_ERROR"],
      [429, "rate_limit_exceeded", "RATE_LIMIT_EXCEEDED"],
      [500, "internal_server_error", "INTERNAL_SERVER_ERROR"],
    ])(
      "exposes the %i status and Resend's %s type as a stable code",
      async (status, name, code) => {
        const thrown = await rejectionOf(hostileRejection(status, name));

        expect(thrown).toMatchObject({
          name: "ResendRequestRejected",
          status,
          code,
          // Still parseable by a consumer that reads only the message.
          message: expect.stringContaining(
            `status ${String(status)}`,
          ) as unknown,
        });
      },
    );

    it("admits only an allow-listed type, never the body's own value", async () => {
      const thrown = await rejectionOf(
        hostileRejection(400, "SOMEONE_EXAMPLE_COM_IS_BAD"),
      );

      expect(thrown).toMatchObject({ status: 400, code: "UNRECOGNISED" });
    });

    it("keeps the status when the body is not JSON", async () => {
      const thrown = await rejectionOf(
        new Response("not json at all", { status: 503 }),
      );

      expect(thrown).toMatchObject({ status: 503, code: "UNRECOGNISED" });
    });
  });

  it("refuses an empty API key rather than failing at send time", () => {
    expect(() =>
      createResendEmailSender({ apiKey: "", from: "a@b.com" }),
    ).toThrow(/api key/i);
  });
});
