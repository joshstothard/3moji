import { createResendEmailSender } from "./resend-email-sender";

const EMAIL = {
  to: "someone@example.com",
  subject: "Verify your email",
  text: "http://localhost:3000/verify?token=abc",
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

  it("refuses an empty API key rather than failing at send time", () => {
    expect(() =>
      createResendEmailSender({ apiKey: "", from: "a@b.com" }),
    ).toThrow(/api key/i);
  });
});
