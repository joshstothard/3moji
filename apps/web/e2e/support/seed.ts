import { randomUUID } from "node:crypto";

import {
  canonicalise,
  claimHandle,
  createCoreServices,
  createDatabase,
  createRecordingEmailSender,
  createSystemClock,
  curatedEmojiSet,
  editProfile,
  finaliseClaim,
  HANDLE_LENGTH,
  type CuratedEmoji,
  type ProfileDraft,
} from "@template/core";

import { unclaimedSeveralHandleKeys } from "./aliases";

/**
 * Seeding for end-to-end specs, **through the domain's use cases and never
 * through SQL** ([#151](https://github.com/joshstothard/3moji/issues/151)).
 *
 * A row inserted by hand holds whatever invariant its author remembered. A
 * Handle seeded here went through the same Claim a visitor makes — the
 * Reserved Handle check, the hold, the Account created in the same transaction
 * — then through the same verification that finalises it, then through the
 * same `editProfile` that validates the Profile's limits. So the data a spec
 * asserts against is data the product could genuinely have produced.
 *
 * It runs in the Playwright process, not in the app, and wires its own
 * services against the same database the app under test reads. Its email goes
 * to a recording sender held here, which is how the verification token is
 * read back; nothing is sent and nothing is logged, because a token printed to
 * a public Actions log is a live credential for as long as it lasts.
 */

/** A Handle that has been claimed, verified and given a Profile. */
export interface SeededHandle {
  /** The Handle's key: its three emoji, canonical. */
  readonly key: string;
  /** The percent-encoded path to its page, e.g. `/%F0%9F%A7%8A…`. */
  readonly path: string;
  /** The three emoji, in order, with the names the picker labels them by. */
  readonly emoji: readonly CuratedEmoji[];
  /** The Profile exactly as saved. */
  readonly profile: ProfileDraft;
  /**
   * The owner's sign-in, for a spec that needs a signed-in session — the edit
   * page's contrast check ([#177](https://github.com/joshstothard/3moji/issues/177)).
   * Both are random and single-use, and never logged.
   */
  readonly credentials: {
    readonly email: string;
    readonly password: string;
  };
}

export interface SeedClaimedHandleOptions {
  /** What to save as the Profile. A plain one is used when omitted. */
  readonly profile?: ProfileDraft;
  /**
   * Chooses the three emoji to try on each attempt. Three random emoji from
   * the whole curated set when omitted.
   *
   * It is called afresh on every attempt, so a chooser drawing at random from
   * a narrower pool keeps the collision-free property: a pick that is taken or
   * reserved is simply tried again. The accessibility spec uses it to seed two
   * Handles one word alias names
   * ([#153](https://github.com/joshstothard/3moji/issues/153)).
   */
  readonly chooseEmoji?: () => readonly CuratedEmoji[];
}

/** How many random Handles to try before concluding something is wrong. */
const ATTEMPTS = 10;

const DEFAULT_PROFILE: ProfileDraft = {
  displayName: "E2E Seeded Profile",
  bio: "Seeded through the domain for an end-to-end test.",
  links: [{ title: "An example link", url: "https://example.com/" }],
};

/**
 * Claims a fresh Handle, verifies it and saves a Profile on it.
 *
 * **Every call claims a different, random Handle**, so specs running in both
 * Playwright projects — or twice, on a retry — never collide over one row. A
 * random pick that happens to be taken or reserved is simply tried again.
 *
 * @throws when the environment is incomplete, or when any step of the domain
 * answers anything but success — a seed that half-worked would make the spec
 * that follows fail for a reason it does not name.
 */
export async function seedClaimedHandle(
  options: SeedClaimedHandleOptions = {},
): Promise<SeededHandle> {
  const profile = options.profile ?? DEFAULT_PROFILE;
  const chooseEmoji = options.chooseEmoji ?? randomHandleEmoji;
  const reserved = unclaimedSeveralHandleKeys();
  const emailSender = createRecordingEmailSender();
  const clock = createSystemClock();
  const { db, close } = createDatabase({ url: requiredEnv("DATABASE_URL") });

  try {
    const services = createCoreServices({
      clock,
      db,
      auth: {
        emailSender,
        baseUrl: requiredEnv("BETTER_AUTH_URL"),
        secret: requiredEnv("BETTER_AUTH_SECRET"),
        from: requiredEnv("RESEND_FROM"),
      },
    });

    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      const emoji = chooseEmoji();
      const segment = emoji.map((entry) => entry.emoji).join("");
      // handle-url.spec.ts needs these Handles unclaimed, and the database is
      // shared by every spec, so a pick naming one is drawn again — whichever
      // chooser made it (#187).
      if (reserved.has(canonicalHandle(segment).key)) {
        continue;
      }
      const email = `e2e-${randomUUID()}@example.com`;
      const password = randomUUID();

      emailSender.clear();
      const claim = await claimHandle({
        segment,
        email,
        password,
        store: services.claims,
        clock,
      });
      if (claim.state === "taken" || claim.state === "not-claimable") {
        continue;
      }
      if (claim.state !== "held") {
        throw new Error(`The seed Claim answered "${claim.state}".`);
      }

      const finalised = await finaliseClaim({
        token: verificationTokenFrom(emailSender.lastSent()?.text),
        dispatches: services.dispatches,
        directory: services.accounts,
        finaliser: services.claimFinaliser,
        clock,
      });
      if (finalised.state !== "claimed") {
        throw new Error(`The seed verification answered "${finalised.state}".`);
      }

      const account = await services.accounts.byEmail(email);
      if (account === undefined) {
        throw new Error("The seeded Account could not be read back.");
      }

      const edit = await editProfile({
        userId: account.userId,
        draft: profile,
        store: services.profileEdits,
        clock,
      });
      if (edit.state !== "saved") {
        throw new Error(
          "The seed Profile was refused by validateProfile; fix the draft.",
        );
      }

      return {
        key: claim.handle.key,
        path: `/${canonicalHandle(segment).encoded}`,
        emoji,
        profile,
        credentials: { email, password },
      };
    }

    throw new Error(
      `No claimable Handle was found in ${String(ATTEMPTS)} random attempts.`,
    );
  } finally {
    await close();
  }
}

/**
 * Reads a variable the seed needs, **without ever echoing its value** — the
 * error names the variable and nothing else.
 */
function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(
      `${name} is not set. The E2E seed needs the same environment as the app under test; see the e2e job in .github/workflows/ci.yml.`,
    );
  }
  return value;
}

/** Three random emoji from the released, curated set. */
function randomHandleEmoji(): readonly CuratedEmoji[] {
  return Array.from({ length: HANDLE_LENGTH }, () => {
    const entry =
      curatedEmojiSet[Math.floor(Math.random() * curatedEmojiSet.length)];
    if (entry === undefined) {
      throw new Error("The curated Emoji Set is empty.");
    }
    return entry;
  });
}

function canonicalHandle(segment: string): {
  readonly key: string;
  readonly encoded: string;
} {
  const result = canonicalise(segment);
  if (!result.ok) {
    throw new Error(`The seed picked a segment that is not a Handle.`);
  }
  return { key: result.key, encoded: result.encoded };
}

/**
 * The token from a verification email. Verification links carry it as a query
 * parameter (`/claim/verify?token=…`); see `docs/architecture/auth.md`.
 */
function verificationTokenFrom(text: string | undefined): string {
  const match = /[?&]token=([^&\s]+)/.exec(text ?? "");
  if (match?.[1] === undefined) {
    throw new Error("The seed Claim sent no verification link.");
  }
  return decodeURIComponent(match[1]);
}
