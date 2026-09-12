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
