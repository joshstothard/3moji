CREATE TABLE "verification_dispatch" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"sent_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "verification_dispatch" ADD CONSTRAINT "verification_dispatch_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "verification_dispatch_token_hash_idx" ON "verification_dispatch" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "verification_dispatch_user_sent_at_idx" ON "verification_dispatch" USING btree ("user_id","sent_at" DESC NULLS LAST);