CREATE TABLE "claim_rate_limit" (
	"bucket" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "claim_rate_limit_pkey" PRIMARY KEY("bucket","window_start"),
	CONSTRAINT "claim_rate_limit_count_positive" CHECK ("claim_rate_limit"."count" > 0)
);
--> statement-breakpoint
CREATE INDEX "claim_rate_limit_window_start_idx" ON "claim_rate_limit" USING btree ("window_start");