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
  DatabaseOrTransaction,
  DatabaseTransaction,
  NeonDatabase,
  NodePostgresDatabase,
} from "./db/client";
export { postgresErrorCode, UNIQUE_VIOLATION } from "./db/postgres-error";

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
export { EMOJI_CURATION } from "./emoji/emoji-curation";
export type { EmojiArticle, EmojiCuration } from "./emoji/emoji-curation";
export {
  curatedEmojiSet,
  findCuratedEmoji,
  searchEmoji,
} from "./emoji/emoji-name";
export type { CuratedEmoji } from "./emoji/emoji-name";
export { spokenHandle } from "./emoji/spoken-handle";

export {
  BLOCKED_EMOJI,
  isReservedHandle,
  reservationOf,
  RESERVED_HANDLES,
  RESERVED_HANDLE_ENTRIES,
} from "./handle/reserved-handles";
export type {
  BlockedEmoji,
  Reservation,
  ReservedHandleEntry,
  ReservedHandleList,
  ReservedScope,
} from "./handle/reserved-handles";
export { canonicalHandleOf, claimableHandle } from "./handle/claimable";
export type {
  ClaimabilityFailure,
  ClaimabilityResult,
  ClaimableHandle,
} from "./handle/claimable";

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
export type { Auth, AuthFactory, AuthFactoryInput } from "./auth/auth-factory";
export { createDeferredEmailSender } from "./auth/adapters/deferred-email-sender";
export type { DeferredEmailSender } from "./auth/adapters/deferred-email-sender";

export type { HandleRepository } from "./ports/handle-repository";
export { createDrizzleHandleRepository } from "./adapters/drizzle-handle-repository";
export { ownershipOf } from "./handle/handle-ownership";
export type { HandleHoldRow, HandleOwnership } from "./handle/handle-ownership";
export { handleAvailability } from "./handle/handle-availability";
export type {
  HandleAvailability,
  HandleAvailabilityInput,
} from "./handle/handle-availability";

export type {
  AccountCreated,
  AccountToCreate,
  ClaimStore,
  ClaimTransaction,
  HoldToWrite,
  HoldWritten,
  TransactionOutcome,
} from "./ports/claim-store";
export { createDrizzleClaimStore } from "./adapters/drizzle-claim-store";
export type { DrizzleClaimStoreInput } from "./adapters/drizzle-claim-store";
export { claimHandle, HOLD_DURATION_MS } from "./handle/claim-handle";
export type { ClaimHandleInput, ClaimResult } from "./handle/claim-handle";
export { submitClaim } from "./handle/submit-claim";
export type { ClaimSubmission, SubmitClaimInput } from "./handle/submit-claim";

export { verificationDispatch } from "./db/verification-dispatch";
export type {
  VerificationDispatch,
  VerificationDispatchStore,
} from "./ports/verification-dispatch-store";
export { createDrizzleVerificationDispatchStore } from "./adapters/drizzle-verification-dispatch-store";
export type { DrizzleVerificationDispatchStoreInput } from "./adapters/drizzle-verification-dispatch-store";
export type {
  AccountDirectory,
  AccountRecord,
  OwnedHandle,
} from "./ports/account-directory";
export { createDrizzleAccountDirectory } from "./adapters/drizzle-account-directory";
export type {
  ClaimFinaliser,
  ClaimFinaliserTransaction,
  EmailVerification,
  HoldFinalised,
} from "./ports/claim-finaliser";
export {
  createDrizzleClaimFinaliser,
  finaliserTransactionOn,
} from "./adapters/drizzle-claim-finaliser";
export { runWithTransactionalAuth } from "./adapters/transactional-auth";
export type { TransactionalAuthInput } from "./adapters/transactional-auth";

export { verificationTokenFingerprint } from "./auth/verification-token";
export { RESEND_LIMITS, resendAllowance } from "./auth/resend-allowance";
export type {
  ResendAllowance,
  ResendAllowanceInput,
  ResendLimits,
} from "./auth/resend-allowance";
export {
  RESPONSE_FLOOR_MS,
  realSleep,
  withResponseFloor,
} from "./auth/response-floor";
export type { ResponseFloorInput } from "./auth/response-floor";
export { resendVerification } from "./auth/resend-verification";
export type {
  ResendOutcome,
  ResendVerificationInput,
  VerificationMailer,
} from "./auth/resend-verification";
export { createBetterAuthVerificationMailer } from "./auth/adapters/better-auth-verification-mailer";
export { finaliseClaim } from "./auth/finalise-claim";
export type {
  ClaimFinalisation,
  FinaliseClaimInput,
} from "./auth/finalise-claim";
export {
  claimCollisionEmail,
  notifyExistingOwner,
} from "./auth/claim-collision";
export type {
  ClaimCollisionEmailInput,
  ClaimCollisionInput,
} from "./auth/claim-collision";
