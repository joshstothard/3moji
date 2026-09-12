export type { Clock } from "./ports/clock";
export { createSystemClock } from "./adapters/system-clock";
export type { CoreDependencies, CoreServices } from "./composition-root";
export { createCoreServices } from "./composition-root";

export { account, authSchema, session, user, verification } from "./db/schema";
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

export type { EmailSender, OutboundEmail } from "./auth/ports/email-sender";
export { createRecordingEmailSender } from "./auth/adapters/recording-email-sender";
export type { RecordingEmailSender } from "./auth/adapters/recording-email-sender";
export { createResendEmailSender } from "./auth/adapters/resend-email-sender";
export type { ResendEmailSenderInput } from "./auth/adapters/resend-email-sender";
export { createAuth } from "./auth/create-auth";
export type { CreateAuthInput } from "./auth/create-auth";
