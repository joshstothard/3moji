# 3moji

3moji (3moji.me) lets a person claim a short sequence of emoji as a handle and point it at a public page of links, so the handle can be said aloud ("ice cube, ice cube, ice cube") and typed on any phone.

## Language

**Account**:
A login identified by an email address and a password. Every live Account owns exactly one Handle.
_Avoid_: user, member, login

**Handle**:
An ordered sequence of emoji from the Emoji Set that an Account has claimed. Two Handles differ if their emoji or their order differ. Only three-emoji Handles are claimable at launch; repetition is allowed.
_Avoid_: username, name, address, tag

**Profile**:
The public page a Handle resolves to: a display name, a bio, and Links.
_Avoid_: page, bio page, linktree

**Link**:
One titled URL on a Profile, shown in the order its owner set.
_Avoid_: button, entry

**Emoji Set**:
The emoji a Handle may use: the single-codepoint emoji of a **released category**. The wider candidate list is larger; only released categories are claimable, and categories are added over time but never withdrawn.
_Avoid_: emoji list, safe emoji

**Released Category**:
A group of emoji made claimable as one drop. Adding a category is additive and safe; removing one could orphan a claimed Handle, so it never happens.
_Avoid_: batch, wave, tranche

**Spoken Name**:
The single canonical English name of one emoji in the Emoji Set, used to say a Handle aloud.
_Avoid_: label, description, alt text

**Claim**:
Taking an unowned Handle for an Account, final once the Account's email is verified. A Handle has at most one owner at a time.
_Avoid_: register, buy, reserve

**Reserved Handle**:
A Handle that no Account may Claim. At launch every one- and two-emoji Handle is reserved, so only three-emoji Handles can be claimed.
_Avoid_: blocked handle, banned handle

**Hold**:
A Handle kept for an Account for 24 hours while it waits for that Account's email to be verified. An expired Hold releases the Handle and deletes the unverified Account.
_Avoid_: blocked handle, banned handle

**Release**:
Deleting an Account and giving up its Handle, which returns to the pool immediately — there is no cooldown in the MVP. There is no Account without a Handle, so Release and account deletion are the same act.
_Avoid_: delete, unregister
