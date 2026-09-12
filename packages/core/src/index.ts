export type { Clock } from "./ports/clock";
export { createSystemClock } from "./adapters/system-clock";
export type { CoreDependencies, CoreServices } from "./composition-root";
export { createCoreServices } from "./composition-root";

export { account, authSchema, session, user, verification } from "./db/schema";
export { handle } from "./db/handle";
export { HANDLE_KEY_LENGTH, handleKeyOf, toHandleKey } from "./db/handle-key";
export type { HandleKey } from "./db/handle-key";
export { resolveDriver } from "./db/driver";
export type { DatabaseDriver, ResolveDriverInput } from "./db/driver";
export { createDatabase } from "./db/client";
export type {
  CreateDatabaseInput,
  Database,
  DatabaseHandle,
  NeonDatabase,
  NodePostgresDatabase,
} from "./db/client";

export { EMOJI_CATEGORIES, RELEASED_CATEGORIES } from "./emoji/emoji-category";
export { isCategoryReleased } from "./emoji/emoji-category";
export type { EmojiCategory } from "./emoji/emoji-category";
export { EMOJI_SET_VERSION } from "./emoji/emoji-candidate";
export type { EmojiCandidate } from "./emoji/emoji-candidate";
export {
  candidateEmojiSet,
  findEmojiByCodepoint,
  isClaimableEmoji,
  releasedEmojiSet,
} from "./emoji/emoji-set";
export type { EmojiSetEntry } from "./emoji/emoji-set";

export { canonicalise, HANDLE_LENGTH } from "./handle/canonicalise";
export type {
  CanonicalHandle,
  CanonicalisationFailure,
  CanonicalisationFailureReason,
  CanonicalisationResult,
} from "./handle/canonicalise";

export type { EmailSender, OutboundEmail } from "./auth/ports/email-sender";
export { createRecordingEmailSender } from "./auth/adapters/recording-email-sender";
export type { RecordingEmailSender } from "./auth/adapters/recording-email-sender";
export { createResendEmailSender } from "./auth/adapters/resend-email-sender";
export type { ResendEmailSenderInput } from "./auth/adapters/resend-email-sender";
export { createAuth } from "./auth/create-auth";
export type { CreateAuthInput } from "./auth/create-auth";
