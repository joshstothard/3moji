import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * The tables Better Auth owns.
 *
 * ADR-0006 decision 5 keeps these in our own Postgres rather than a hosted auth
 * service, because owning the rows is what makes the data portable.
 *
 * **The property keys are load-bearing.** Better Auth's Drizzle adapter looks a
 * table up by its model name and addresses columns by the Drizzle property key,
 * so renaming a key breaks authentication at runtime rather than at build time.
 * Database column names are free to follow Postgres convention; `schema.test.ts`
 * asserts the keys against Better Auth's own runtime description of what it
 * needs, so an upstream change fails a test instead of production.
 */

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
};

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  ...timestamps,
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  ...timestamps,
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", {
    withTimezone: true,
  }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
    withTimezone: true,
  }),
  scope: text("scope"),
  /** Only set for `providerId = "credential"`: the hashed password. */
  password: text("password"),
  ...timestamps,
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ...timestamps,
});

/**
 * Passed straight to Better Auth's Drizzle adapter. The keys must stay equal to
 * Better Auth's model names; the adapter resolves `schema[modelName]`.
 */
export const authSchema = { user, session, account, verification };
