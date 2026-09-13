/**
 * The password lengths Better Auth accepts, **stated rather than left to its
 * defaults** (8 and 128 in better-auth 1.7.4), so the set-new-password form can
 * tell the browser the same numbers the server enforces
 * ([#192](https://github.com/joshstothard/3moji/issues/192)).
 *
 * A module of its own, importing nothing, so a web test can read the real
 * values from source without loading Better Auth, which is ESM-only.
 * `createAuth` passes both to `emailAndPassword`.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
