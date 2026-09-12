CREATE TABLE "handle" (
	"key" text collate "C" PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"held_until" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "handle_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "handle_key_three_codepoints" CHECK (char_length("handle"."key") = 3)
);
--> statement-breakpoint
ALTER TABLE "handle" ADD CONSTRAINT "handle_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;