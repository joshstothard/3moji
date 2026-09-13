/** One submission to count: which bucket, and which window it falls in. */
export interface ClaimRateLimitHit {
  /** `client:<hmac hex>` or `email:<hmac hex>`. Never an address. */
  readonly bucket: string;
  readonly windowStart: Date;
}

/**
 * What the Claim's rate limit needs from storage
 * ([#157](https://github.com/joshstothard/3moji/issues/157)).
 *
 * One verb, because the decision needs one fact per bucket — how many
 * submissions it has made in its window, counting this one — and that fact is
 * only trustworthy if reading it and adding to it are the same act. A port with
 * a separate `read` and `increment` would invite the read-then-write race the
 * limit exists to close: two concurrent submissions both read the old count and
 * both get in.
 */
export interface ClaimRateLimitStore {
  /**
   * Count one more submission in every hit's bucket and window, atomically per
   * bucket, and answer each bucket's new count **in the order the hits were
   * given**.
   *
   * It also forgets every window that started before `forgetBefore`, so the
   * table holds no more history than the limit reads. The hits must name
   * distinct buckets.
   *
   * It rejects rather than answering when the store cannot be read or written:
   * the caller fails closed, and a guessed count would fail open.
   */
  record(
    hits: readonly ClaimRateLimitHit[],
    forgetBefore: Date,
  ): Promise<readonly number[]>;
}
