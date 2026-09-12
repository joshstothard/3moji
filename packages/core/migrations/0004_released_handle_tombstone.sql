CREATE TABLE "released_handle" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text collate "C" NOT NULL,
	"released_at" timestamp with time zone NOT NULL
);
