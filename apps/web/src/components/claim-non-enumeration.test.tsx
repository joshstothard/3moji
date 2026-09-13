import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as Core from "@template/core";

import en from "../../../../packages/shared/messages/en.json";

/**
 * The non-enumeration promise, kept all the way to the screen
 * ([#115](https://github.com/joshstothard/3moji/issues/115) acceptance
 * criterion 4, [#15](https://github.com/joshstothard/3moji/issues/15)).
 *
 * **An already-registered address must be indistinguishable from a genuine
 * sign-up**, and "indistinguishable" is about everything observable — where the
 * visitor lands, the URL, what the form does in the meantime, where focus goes
 * and what is announced — not merely that both "succeed".
 *
 * So nothing between the form and the domain is faked here. The **real**
 * `submitClaim` runs (from source: the package root reaches better-auth, which
 * is ESM-only and cannot be `require`d in this suite, but `submit-claim.ts` and
 * everything it imports are pure), behind the **real** `submitClaimAction`,
 * rendered by the **real** form and landing on the **real** hold screen. Only
 * the edges are fakes: the claim store, the Account directory and the email
 * sender, which is what makes the two scenarios differ.
 *
 * Every assertion that two outcomes are equal is paired with one that the two
 * scenarios genuinely took different paths through the domain — otherwise
 * "identical" would be satisfied by running the same scenario twice.
 */
jest.mock("@template/core", () => {
  const actual = jest.requireActual<{
    readonly submitClaim: typeof Core.submitClaim;
  }>("../../../../packages/core/src/handle/submit-claim");
  return { submitClaim: actual.submitClaim };
});

const ICE = "\u{1F9CA}\u{1F9CA}\u{1F9CA}";
const ENCODED = "%F0%9F%A7%8A%F0%9F%A7%8A%F0%9F%A7%8A";
const EMAIL = "claimant@example.com";
const PASSWORD = "correct horse battery staple";
const NOW = new Date("2026-09-13T12:00:00.000Z");
/** `RESPONSE_FLOOR_MS` in `packages/core/src/auth/response-floor.ts`. */
const RESPONSE_FLOOR_MS = jest.requireActual<{
  readonly RESPONSE_FLOOR_MS: number;
}>("../../../../packages/core/src/auth/response-floor").RESPONSE_FLOOR_MS;

type Who = "a new address" | "an already-registered address";

interface SentEmail {
  readonly to: string;
}

/** What the fakes saw, so a test can prove the two scenarios really differed. */
const seen: { who: Who; accountsCreated: number; sent: SentEmail[] } = {
  who: "a new address",
  accountsCreated: 0,
  sent: [],
};

interface WorkOutcome {
  readonly commit: boolean;
  readonly value: unknown;
}

/**
 * The transaction the Claim runs in. The only thing that varies between the
 * two scenarios is what `createAccount` answers — which is exactly where the
 * real adapter decides an address is already registered.
 */
const services = () => ({
  clock: { now: () => NOW },
  claims: {
    runInTransaction: async (
      work: (tx: Readonly<Record<string, unknown>>) => Promise<WorkOutcome>,
    ) => {
      const outcome = await work({
        availabilityOf: () => Promise.resolve("available"),
        freeExpiredHold: () => Promise.resolve({ freed: false }),
        createAccount: () => {
          seen.accountsCreated += 1;
          return Promise.resolve(
            seen.who === "a new address"
              ? { ok: true, userId: "user-1" }
              : { ok: false, reason: "email-taken" },
          );
        },
        holdHandle: () => Promise.resolve({ ok: true }),
      });
      return outcome.value;
    },
  },
  accounts: {
    byEmail: (email: string) =>
      Promise.resolve({ userId: "user-9", email, emailVerified: true }),
    handleOf: () =>
      Promise.resolve({
        key: ICE,
        heldUntil: new Date("2026-09-14T12:00:00.000Z"),
        claimedAt: new Date("2026-09-13T09:00:00.000Z"),
      }),
  },
  emailSender: {
    send: (email: SentEmail) => {
      seen.sent.push(email);
      return Promise.resolve();
    },
  },
  resetRequestUrl: "http://localhost:3000/reset-password",
  emailFrom: "3moji <no-reply@mail.3moji.me>",
  // Not the limit under test here: `claim-rate-limit.test.tsx` is (#157).
  claimRateLimiter: { admit: () => Promise.resolve("admitted") },
});
jest.mock("../lib/services", () => ({
  getServices: () => services(),
}));
jest.mock("next/headers", () => ({
  headers: () =>
    Promise.resolve(new Headers({ "x-vercel-forwarded-for": "203.0.113.7" })),
}));

/**
 * Real Next.js `redirect` throws, and the throw is how an accepted Claim leaves
 * the action. `jest.setup.ts` stubs it as a bare `jest.fn()`, which would let
 * execution fall out of the action and return `undefined` instead.
 */
const REDIRECT = "NEXT_REDIRECT";
const redirected: string[] = [];
/**
 * The **real** throw, so the boundary line (#156) classifies a redirect the way
 * production does — by Next.js's own digest, not by a message.
 */
const navigation = jest.requireActual<{
  readonly redirect: (url: string) => never;
  readonly notFound: () => never;
}>("next/navigation");
jest.mock("next/navigation", () => ({
  redirect: (url: string): never => {
    redirected.push(url);
    return navigation.redirect(url);
  },
  notFound: (): never => navigation.notFound(),
}));

/** The hold screen's resend is a server action; it is not under test here. */
jest.mock("./resend-action", () => ({
  requestNewVerificationLink: jest.fn(),
}));

import { submitClaimAction, type ClaimFormState } from "./claim-action";
import { ClaimForm } from "./claim-form";
import HeldPage from "../app/claim/held/[handle]/page";

function messageOf(error: unknown): unknown {
  if (typeof error === "object" && error !== null && "message" in error) {
    return error.message;
  }
  return error;
}

function claimAs(who: Who): void {
  seen.who = who;
  seen.accountsCreated = 0;
  seen.sent = [];
  redirected.length = 0;
}

function formData(): FormData {
  const data = new FormData();
  data.set("handle", ENCODED);
  data.set("email", EMAIL);
  data.set("password", PASSWORD);
  return data;
}

/** Everything the action does that a caller can observe. */
async function actionOutcome(who: Who) {
  claimAs(who);
  let returned: unknown;
  let thrown: unknown;
  try {
    returned = await submitClaimAction(formData());
  } catch (error) {
    thrown = messageOf(error);
  }
  return {
    observable: { returned, thrown, redirected: [...redirected] },
    accountsCreated: seen.accountsCreated,
    sent: seen.sent.length,
  };
}

describe("an already-registered address, from the form to the hold screen", () => {
  afterEach(() => {
    cleanup();
  });

  it("gets exactly the answer a new address gets from the action", async () => {
    const fresh = await actionOutcome("a new address");
    const collision = await actionOutcome("an already-registered address");

    // The two really did take different paths through the domain: both tried
    // to create an Account, and only the collision told an existing owner.
    expect(fresh.accountsCreated).toBe(1);
    expect(collision.accountsCreated).toBe(1);
    expect(fresh.sent).toBe(0);
    expect(collision.sent).toBe(1);

    // ...and nothing the caller can see differs.
    expect(collision.observable).toEqual(fresh.observable);
    expect(fresh.observable).toEqual({
      returned: undefined,
      thrown: REDIRECT,
      redirected: [`/claim/held/${ENCODED}?reason=pending`],
    });
  });

  it("writes the same boundary line for both, measured after the response floor (#156)", async () => {
    const lines: Record<string, unknown>[] = [];
    const logged = jest
      .spyOn(console, "log")
      .mockImplementation((...args: unknown[]) => {
        const [first] = args;
        if (typeof first !== "string") return;
        const value: unknown = JSON.parse(first);
        if (
          typeof value === "object" &&
          value !== null &&
          "event" in value &&
          value.event === "api_boundary"
        ) {
          lines.push(Object.fromEntries(Object.entries(value)));
        }
      });

    const fresh = await actionOutcome("a new address");
    const collision = await actionOutcome("an already-registered address");
    logged.mockRestore();

    // The two really did take different paths through the domain.
    expect(fresh.sent).toBe(0);
    expect(collision.sent).toBe(1);

    expect(lines).toHaveLength(2);
    const [freshLine, collisionLine] = lines;
    const { durationMs: freshMs, ...freshRest } = freshLine ?? {};
    const { durationMs: collisionMs, ...collisionRest } = collisionLine ?? {};

    // Every field but the duration is identical, and names the success.
    expect(collisionRest).toEqual(freshRest);
    expect(freshRest).toEqual({
      event: "api_boundary",
      boundary: "claim.submit",
      outcome: "redirected",
      correlationId: "none",
    });

    // The duration is taken around the whole call, so the floor that pads the
    // fast branch is inside it: neither line can be told apart by a fast time.
    expect(freshMs).toBeGreaterThanOrEqual(RESPONSE_FLOOR_MS);
    expect(collisionMs).toBeGreaterThanOrEqual(RESPONSE_FLOOR_MS);
  });

  it("lands on a hold screen that is byte-for-byte the same page", async () => {
    const pages: string[] = [];

    for (const who of [
      "a new address",
      "an already-registered address",
    ] as const) {
      const { observable } = await actionOutcome(who);
      const [destination] = observable.redirected;
      if (destination === undefined) throw new Error(`${who} did not redirect`);

      const url = new URL(destination, "https://3moji.me");
      const handle = url.pathname.split("/").at(-1) ?? "";
      const { container } = render(
        await HeldPage({
          params: Promise.resolve({ handle }),
          searchParams: Promise.resolve(
            Object.fromEntries(url.searchParams.entries()),
          ),
        }),
      );

      expect(
        screen.getByRole("heading", {
          level: 1,
          name: en.Claim.pendingHeading,
        }),
      ).toBeInTheDocument();
      pages.push(container.innerHTML);
      cleanup();
    }

    expect(pages[0]).not.toBe("");
    expect(pages[1]).toBe(pages[0]);
  });

  it("leaves the form looking, focused and announcing exactly the same", async () => {
    const snapshots: {
      readonly html: string;
      readonly focused: string | undefined;
      readonly announced: string | null;
    }[] = [];

    for (const who of [
      "a new address",
      "an already-registered address",
    ] as const) {
      claimAs(who);
      /*
       * The real action, adapted to the form's `(previous, formData)` shape.
       * An accepted Claim throws `redirect`; in a browser Next.js then
       * navigates and the action never settles into state, which is what a
       * promise that never resolves stands in for.
       */
      const claim = async (
        _previous: ClaimFormState,
        data: FormData,
      ): Promise<ClaimFormState> => {
        try {
          return await submitClaimAction(data);
        } catch (error) {
          if (messageOf(error) === REDIRECT) {
            return new Promise<ClaimFormState>(() => undefined);
          }
          throw error;
        }
      };

      const user = userEvent.setup();
      const { container } = render(
        <ClaimForm claim={claim} handle={ENCODED} />,
      );
      await user.type(screen.getByLabelText(en.Claim.claimEmailLabel), EMAIL);
      await user.type(
        screen.getByLabelText(en.Claim.claimPasswordLabel),
        PASSWORD,
      );
      await user.click(
        screen.getByRole("button", { name: en.Claim.claimSubmit }),
      );

      await waitFor(
        () => {
          expect(redirected).toHaveLength(1);
        },
        { timeout: 3000 },
      );

      snapshots.push({
        html: container.innerHTML,
        focused: document.activeElement?.outerHTML,
        announced: screen.getByRole("alert").textContent,
      });
      cleanup();
    }

    expect(seen.sent).toHaveLength(1);
    expect(snapshots[0]?.announced).toBe("");
    expect(snapshots[1]).toEqual(snapshots[0]);
  });
});
