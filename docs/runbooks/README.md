# Runbooks

Step-by-step procedures for things that happen to the running service. `AGENTS.md` § Observability asks for one per top incident type.

A runbook is written for the person on call at the moment it is needed: numbered steps, the exact commands, what to record, and who to tell. It links to the architecture docs for the _why_ rather than repeating it.

| Runbook                                       | When to use it                                                                                                                                                  |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Takedown](takedown.md)                       | Somebody reports a Profile or a Handle — phishing, illegal content, impersonation, or abuse.                                                                    |
| [Site down](site-down.md)                     | The site does not answer, or every request fails.                                                                                                               |
| [Email not arriving](email-not-arriving.md)   | A verification, collision or password reset email did not reach somebody, or the Resend daily cap is used up.                                                   |
| [Restore from backup](restore-from-backup.md) | Production data is wrong or gone. Neon's six-hour restore window today; the nightly backup is pending [#206](https://github.com/joshstothard/3moji/issues/206). |

The last three are Phase 8 of [the MVP workstream](../workstreams/3moji-mvp.md) ([#207](https://github.com/joshstothard/3moji/issues/207)). They were written before the first deploy ([#32](https://github.com/joshstothard/3moji/issues/32)), so steps marked **(verify on deploy)** must be confirmed the first time they are used. **Vercel Hobby keeps runtime logs for one hour**, so every runbook that reads logs starts by capturing them.
