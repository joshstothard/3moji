-- #214: Better Auth's rate-limit counters were keyed `<client address>|<path>`
-- in clear. They are now keyed by an HMAC under a key derived from the auth
-- secret, which the database does not hold, so these rows cannot be rewritten
-- here, and no new key can ever match one, so they count nothing. They are
-- deleted rather than left for pruning. The longest window is an hour, so this
-- resets at most an hour of limiting.
DELETE FROM "auth_rate_limit";
