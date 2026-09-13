import { createHmac } from "node:crypto";
import { isIP } from "node:net";

import { normaliseEmailAddress } from "../auth/email-address";
import type {
  ClaimRateLimitHit,
  ClaimRateLimitStore,
} from "../ports/claim-rate-limit-store";
import type { Clock } from "../ports/clock";

const HOUR_MS = 60 * 60 * 1000;

/** One limit: how many submissions a bucket may make in one fixed window. */
export interface ClaimRateLimit {
  readonly maxPerWindow: number;
  readonly windowMs: number;
}

/**
 * How often a Claim may be submitted
 * ([#157](https://github.com/joshstothard/3moji/issues/157)).
 *
 * **Starting values to tune, not principles** — an open question from planning,
 * recorded for the repo owner on the pull request that introduced them.
 *
 * - **Three an hour per email address**, matching `RESEND_LIMITS`. A Claim that
 *   names a registered address mails that address's owner, so this is the
 *   figure that bounds how many collision notices one inbox can receive. A
 *   legitimate person rarely submits twice: the builder shows availability
 *   before the form appears, so a Claim is refused as `taken` only when a race
 *   was lost in the moment between.
 * - **Ten an hour per client address**, looser because one address can be many
 *   people — a household, an office, a carrier's NAT.
 *
 * Both windows are fixed, not rolling, so a bucket can make up to twice its
 * limit across a window boundary. That is the price of an increment Postgres
 * can take atomically in one statement.
 */
export interface ClaimRateLimits {
  readonly perClientAddress: ClaimRateLimit;
  readonly perEmailAddress: ClaimRateLimit;
}

export const CLAIM_RATE_LIMITS: ClaimRateLimits = {
  perClientAddress: { maxPerWindow: 10, windowMs: HOUR_MS },
  perEmailAddress: { maxPerWindow: 3, windowMs: HOUR_MS },
};

/**
 * Whether a submission may reach the Claim.
 *
 * **Deliberately two values and no more.** No field says which limit was hit,
 * and none says when to try again: a client-address window and an email
 * window would give different answers to "when", and that difference is
 * exactly the signal the rate-limited answer must not carry.
 */
export type ClaimAdmission = "admitted" | "rate-limited";

export interface ClaimAdmissionInput {
  /** Submissions from this client address in its window, counting this one. */
  readonly clientCount: number;
  /** Submissions naming this email address in its window, counting this one. */
  readonly emailCount: number;
  readonly limits?: ClaimRateLimits;
}

/**
 * The decision, as a pure function of the two counts behind it.
 *
 * Counts include the submission being decided, so a count equal to the limit
 * is admitted and the next is not: "three an hour" admits three.
 */
export function claimAdmission(input: ClaimAdmissionInput): ClaimAdmission {
  const limits = input.limits ?? CLAIM_RATE_LIMITS;
  return input.clientCount > limits.perClientAddress.maxPerWindow ||
    input.emailCount > limits.perEmailAddress.maxPerWindow
    ? "rate-limited"
    : "admitted";
}

/** The start of the fixed window `now` falls in. */
export function windowStartOf(now: Date, windowMs: number): Date {
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
}

/** The bucket every unreadable client address shares. */
const UNKNOWN_CLIENT = "unknown";

/** The eight groups of a valid IPv6 address, whatever its spelling. */
function ipv6Groups(address: string): readonly number[] {
  let text = address.toLowerCase();

  // An embedded IPv4 tail (`::ffff:203.0.113.7`) is the last two groups.
  const tailStart = text.lastIndexOf(":") + 1;
  const tail = text.slice(tailStart);
  if (tail.includes(".")) {
    const octets = tail.split(".").map(Number);
    const high = ((octets[0] ?? 0) << 8) | (octets[1] ?? 0);
    const low = ((octets[2] ?? 0) << 8) | (octets[3] ?? 0);
    text = `${text.slice(0, tailStart)}${high.toString(16)}:${low.toString(16)}`;
  }

  const [head = "", rest] = text.split("::");
  const headGroups = head === "" ? [] : head.split(":");
  const restGroups = rest === undefined || rest === "" ? [] : rest.split(":");
  const missing =
    rest === undefined ? 0 : 8 - headGroups.length - restGroups.length;

  return [
    ...headGroups,
    ...Array<string>(missing).fill("0"),
    ...restGroups,
  ].map((group) => Number.parseInt(group, 16));
}

/**
 * The bucket a client address counts against, from whatever the transport
 * read out of the forwarded headers.
 *
 * - **IPv4**: the address itself.
 * - **IPv6**: its `/64` prefix. One subscriber is routinely handed a whole /64, so a
 *   per-address limit on IPv6 is a limit an attacker steps around by changing
 *   the last 64 bits.
 * - **An IPv4-mapped IPv6 address** counts as the IPv4 address it carries, so
 *   one client does not get two buckets by arriving on a dual-stack socket.
 * - **Anything else** — missing, empty, a list, an address with a port, text —
 *   shares one `unknown` bucket. That is deterministic and costs something:
 *   everybody whose address cannot be read shares one limit. The alternative,
 *   no limit for an unreadable address, would let anyone bypass the limit by
 *   sending a malformed header.
 *
 * The string is validated here, not trusted: a server action is a public
 * endpoint and a forwarded header is only as honest as the proxy that set it.
 */
export function clientAddressBucket(raw: string | undefined): string {
  if (raw === undefined) return UNKNOWN_CLIENT;
  const address = raw.trim();

  // A zone index (`fe80::1%eth0`) names an interface on the server, not a
  // client, and `isIP` accepts it; it is dropped before anything reads groups.
  const [unzoned = ""] = address.split("%");

  switch (isIP(address)) {
    case 4:
      return `ipv4:${address}`;
    case 6: {
      const groups = ipv6Groups(unzoned);
      const mapped =
        groups.slice(0, 5).every((group) => group === 0) &&
        groups[5] === 0xffff;
      if (mapped) {
        const high = groups[6] ?? 0;
        const low = groups[7] ?? 0;
        return `ipv4:${String(high >> 8)}.${String(high & 0xff)}.${String(low >> 8)}.${String(low & 0xff)}`;
      }
      return `ipv6:${groups
        .slice(0, 4)
        .map((group) => group.toString(16))
        .join(":")}::/64`;
    }
    default:
      return UNKNOWN_CLIENT;
  }
}

/**
 * Domain separation for the key the buckets are hashed under. Changing it
 * resets every counter, which is harmless: the longest window is an hour.
 */
const KEY_LABEL = "3moji claim rate limit bucket key v1";

function bucketKeyFrom(secret: string): Buffer {
  return createHmac("sha256", secret).update(KEY_LABEL).digest();
}

/**
 * What a bucket counts. The kind is both the stored prefix and part of the
 * hashed input, so two kinds never share a counter for the same value.
 * `resend-client` is the resend action's per-client limit (#158) and
 * `sign-in-client` the sign-in form's (#180); both share this table rather
 * than adding one.
 */
export type RateLimitBucketKind =
  "client" | "email" | "resend-client" | "sign-in-client";

/**
 * How long every limiter on `claim_rate_limit` keeps a window before pruning
 * it. **The table is shared**, and each limiter's call prunes every row older
 * than this — so it must be at least the longest window of every limiter on the
 * table, or one limiter deletes another's live counter and that limit fails
 * open. `resend-rate-limit.test.ts` asserts every shipped window fits.
 */
export const RATE_LIMIT_RETENTION_MS = HOUR_MS;

function bucketOf(
  key: Buffer,
  kind: RateLimitBucketKind,
  value: string,
): string {
  const digest = createHmac("sha256", key)
    .update(`${kind}:${value}`)
    .digest("hex");
  return `${kind}:${digest}`;
}

/**
 * One stored bucket name: `kind:` and an HMAC of the value under the key
 * derived from `secret`. For limiters other than the Claim's that share its
 * table and its hashing scheme.
 */
export function keyedRateLimitBucket(
  secret: string,
  kind: RateLimitBucketKind,
  value: string,
): string {
  return bucketOf(bucketKeyFrom(secret), kind, value);
}

export interface ClaimRateLimitBucketsInput {
  readonly secret: string;
  readonly clientAddress: string | undefined;
  /** As typed; normalised here (#163). */
  readonly email: string;
}

/**
 * The two buckets a submission counts against, as they are stored.
 *
 * **A keyed hash, never the address.** The counter table would otherwise be a
 * list of who tried to claim, from where, and when. A plain SHA-256 would not
 * be enough: an email address has so little entropy that anyone holding the
 * table could confirm a guess by hashing it. An HMAC under a key derived from
 * the auth secret cannot be checked without that secret.
 *
 * **The auth secret, and not a new one**: `BETTER_AUTH_SECRET` is already
 * required, already at least 32 characters (`createAuth` refuses shorter), and
 * already kept out of the repository. The key is derived from it under a fixed
 * label rather than used directly, so these hashes and Better Auth's own use of
 * the secret can never be mistaken for each other. Rotating the secret resets
 * every counter, which costs at most an hour of limiting.
 *
 * The email address is normalised first, so `Someone@Example.com` and
 * `someone@example.com` share one counter — the Claim treats them as one
 * address, and a limit that did not would let the case of a letter buy three
 * more notices to the same inbox.
 */
export function claimRateLimitBuckets(input: ClaimRateLimitBucketsInput): {
  readonly client: string;
  readonly email: string;
} {
  const key = bucketKeyFrom(input.secret);
  return {
    client: bucketOf(key, "client", clientAddressBucket(input.clientAddress)),
    email: bucketOf(key, "email", normaliseEmailAddress(input.email)),
  };
}

/** A submission, as the limiter needs to see it. */
export interface ClaimSubmissionToAdmit {
  /** The client's address as the transport read it. Not trusted. */
  readonly clientAddress: string | undefined;
  /** As typed. */
  readonly email: string;
}

/** The Claim's rate limit, bound to its store, clock and key. */
export interface ClaimRateLimiter {
  admit(submission: ClaimSubmissionToAdmit): Promise<ClaimAdmission>;
}

export interface ClaimRateLimiterInput {
  readonly store: ClaimRateLimitStore;
  /** The one place the window's time is read. */
  readonly clock: Clock;
  /** The auth secret the bucket key is derived from. */
  readonly secret: string;
  readonly limits?: ClaimRateLimits;
}

/**
 * The Claim's rate limit: per client address and per email address.
 *
 * **Both buckets are counted on every submission, in one call, before either
 * is judged.** Consulting the client limit first and stopping there would make
 * a client-limited refusal measurably faster than an email-limited one, and the
 * rate-limited answer must not reveal which it was. Counting both is also what
 * the limit means: each is "submissions naming X", and a refused submission is
 * still one.
 *
 * **It counts submissions, never Accounts.** Nothing here reads whether the
 * address is registered, so the limit behaves identically either way — which is
 * what keeps it from becoming an enumeration oracle.
 *
 * A store that cannot count makes `admit` reject, and the Claim is refused. A
 * Claim needs the database anyway, so failing closed costs nothing a failing
 * database was not already costing.
 */
export function createClaimRateLimiter(
  input: ClaimRateLimiterInput,
): ClaimRateLimiter {
  if (input.secret === "") {
    throw new Error(
      "createClaimRateLimiter requires the auth secret; without one every bucket hash could be recomputed from a guess.",
    );
  }
  const limits = input.limits ?? CLAIM_RATE_LIMITS;
  // Never less than the shared retention: other limiters count on this table
  // (#158), and pruning by a shorter window would delete their live rows.
  const longestWindowMs = Math.max(
    limits.perClientAddress.windowMs,
    limits.perEmailAddress.windowMs,
    RATE_LIMIT_RETENTION_MS,
  );

  return {
    async admit(submission) {
      const now = input.clock.now();
      const buckets = claimRateLimitBuckets({
        secret: input.secret,
        clientAddress: submission.clientAddress,
        email: submission.email,
      });

      // Client first, then email, on every submission: the adapter's lock
      // order depends on it.
      const hits: readonly ClaimRateLimitHit[] = [
        {
          bucket: buckets.client,
          windowStart: windowStartOf(now, limits.perClientAddress.windowMs),
        },
        {
          bucket: buckets.email,
          windowStart: windowStartOf(now, limits.perEmailAddress.windowMs),
        },
      ];

      const counts = await input.store.record(
        hits,
        new Date(now.getTime() - longestWindowMs),
      );
      const [clientCount, emailCount] = counts;
      if (
        counts.length !== hits.length ||
        clientCount === undefined ||
        emailCount === undefined
      ) {
        throw new Error(
          "the rate-limit store answered with the wrong number of counts.",
        );
      }

      return claimAdmission({ clientCount, emailCount, limits });
    },
  };
}
