# Architecture — current state

This folder describes **what is true now**. Read it before `docs/adr/`: ADRs record why decisions were made, these files record the result. Per `AGENTS.md` § ADR reading policy, an ADR that changes current-state behaviour must update the relevant file here in the same PR.

| File                                     | Covers                                             |
| ---------------------------------------- | -------------------------------------------------- |
| [system-overview.md](system-overview.md) | Apps, packages, how they talk, how work is tracked |
| [data-model.md](data-model.md)           | Account, Handle, Profile, Link, and the Emoji Set  |
| [auth.md](auth.md)                       | Sign-in, verification, and the gate on claiming    |

Add a file per area as the system grows (for example `routing.md`, `data-flow.md`, `micro-frontends.md`), and list it in the table above.
