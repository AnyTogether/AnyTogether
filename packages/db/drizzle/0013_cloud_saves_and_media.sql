CREATE TABLE "media" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"sha256" text NOT NULL,
	"content_type" text NOT NULL,
	"thumb_sha256" text,
	"poster_sha256" text,
	"size" bigint NOT NULL,
	"width" integer,
	"height" integer,
	"duration_ms" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"used_at" timestamp with time zone,
	"gallery_position" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_kind" CHECK ("media"."kind" in ('image', 'clip', 'voice')),
	CONSTRAINT "media_status" CHECK ("media"."status" in ('active', 'hidden')),
	CONSTRAINT "media_gallery" CHECK ("media"."gallery_position" between 0 and 11)
);
--> statement-breakpoint
CREATE TABLE "save_slots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"title_id" text NOT NULL,
	"slot" text NOT NULL,
	"last_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "save_title_id" CHECK ("save_slots"."title_id" ~ '^[A-Z]{4}[0-9]{5}$'),
	CONSTRAINT "save_slot_length" CHECK (length("save_slots"."slot") between 1 and 64)
);
--> statement-breakpoint
CREATE TABLE "save_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slot_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"sha256" text NOT NULL,
	"size" bigint NOT NULL,
	"device" text,
	"launcher_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storage_accounts" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"used_bytes" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storage_used" CHECK ("storage_accounts"."used_bytes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stored_files" (
	"account_id" uuid NOT NULL,
	"sha256" text NOT NULL,
	"size" bigint NOT NULL,
	"content_type" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stored_files_account_id_sha256_pk" PRIMARY KEY("account_id","sha256"),
	CONSTRAINT "stored_file_kind" CHECK ("stored_files"."kind" in ('save', 'media')),
	CONSTRAINT "stored_file_size" CHECK ("stored_files"."size" >= 0)
);
--> statement-breakpoint
CREATE TABLE "uploads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"size" bigint NOT NULL,
	"sha256" text NOT NULL,
	"part_size" integer NOT NULL,
	"parts" integer NOT NULL,
	"received" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"meta" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_account_id_sha256_stored_files_account_id_sha256_fk" FOREIGN KEY ("account_id","sha256") REFERENCES "public"."stored_files"("account_id","sha256") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_account_id_thumb_sha256_stored_files_account_id_sha256_fk" FOREIGN KEY ("account_id","thumb_sha256") REFERENCES "public"."stored_files"("account_id","sha256") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_account_id_poster_sha256_stored_files_account_id_sha256_fk" FOREIGN KEY ("account_id","poster_sha256") REFERENCES "public"."stored_files"("account_id","sha256") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "save_slots" ADD CONSTRAINT "save_slots_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "save_versions" ADD CONSTRAINT "save_versions_slot_id_save_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."save_slots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "save_versions" ADD CONSTRAINT "save_versions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "save_versions" ADD CONSTRAINT "save_versions_account_id_sha256_stored_files_account_id_sha256_fk" FOREIGN KEY ("account_id","sha256") REFERENCES "public"."stored_files"("account_id","sha256") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_accounts" ADD CONSTRAINT "storage_accounts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_account_id_id_index" ON "media" USING btree ("account_id","id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "media_gallery_place" ON "media" USING btree ("account_id","gallery_position") WHERE "media"."gallery_position" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "save_slot_name" ON "save_slots" USING btree ("account_id","title_id","slot");--> statement-breakpoint
CREATE UNIQUE INDEX "save_version_number" ON "save_versions" USING btree ("slot_id","version");--> statement-breakpoint
CREATE INDEX "save_versions_account_id_index" ON "save_versions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "uploads_account_id_index" ON "uploads" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "uploads_expires_at_index" ON "uploads" USING btree ("expires_at");