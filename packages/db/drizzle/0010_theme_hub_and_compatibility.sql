CREATE TABLE "blobs" (
	"key" text NOT NULL,
	"part" integer NOT NULL,
	"bytes" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blobs_key_part_pk" PRIMARY KEY("key","part")
);
--> statement-breakpoint
CREATE TABLE "compat_reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid,
	"title_id" text NOT NULL,
	"platform" text NOT NULL,
	"status" text NOT NULL,
	"launcher_version" text NOT NULL,
	"engine_version" text,
	"game_version" text,
	"machine" text,
	"os" text,
	"fps_avg" real,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "compat_platform" CHECK ("compat_reports"."platform" in ('macos', 'windows', 'linux')),
	CONSTRAINT "compat_status" CHECK ("compat_reports"."status" in ('nothing', 'boots', 'menus', 'ingame', 'playable')),
	CONSTRAINT "compat_note" CHECK (length("compat_reports"."note") <= 500)
);
--> statement-breakpoint
CREATE TABLE "compat_summaries" (
	"title_id" text NOT NULL,
	"platform" text NOT NULL,
	"status" text NOT NULL,
	"version" text NOT NULL,
	"tested_at" timestamp with time zone NOT NULL,
	"reports" integer NOT NULL,
	CONSTRAINT "compat_summaries_title_id_platform_pk" PRIMARY KEY("title_id","platform")
);
--> statement-breakpoint
CREATE TABLE "theme_likes" (
	"theme_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "theme_likes_theme_id_account_id_pk" PRIMARY KEY("theme_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "themes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"maker_id" uuid,
	"source_id" text,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'published' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"style" integer DEFAULT 0 NOT NULL,
	"colors" jsonb NOT NULL,
	"design" jsonb NOT NULL,
	"background" text,
	"music" boolean DEFAULT false NOT NULL,
	"size" integer NOT NULL,
	"sha256" text NOT NULL,
	"downloads" integer DEFAULT 0 NOT NULL,
	"likes" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "theme_status" CHECK ("themes"."status" in ('published', 'review', 'hidden')),
	CONSTRAINT "theme_background" CHECK ("themes"."background" in ('picture', 'video')),
	CONSTRAINT "theme_name" CHECK (length("themes"."name") <= 60),
	CONSTRAINT "theme_description" CHECK (length("themes"."description") <= 500)
);
--> statement-breakpoint
ALTER TABLE "compat_reports" ADD CONSTRAINT "compat_reports_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compat_reports" ADD CONSTRAINT "compat_reports_title_id_games_title_id_fk" FOREIGN KEY ("title_id") REFERENCES "public"."games"("title_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compat_summaries" ADD CONSTRAINT "compat_summaries_title_id_games_title_id_fk" FOREIGN KEY ("title_id") REFERENCES "public"."games"("title_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theme_likes" ADD CONSTRAINT "theme_likes_theme_id_themes_id_fk" FOREIGN KEY ("theme_id") REFERENCES "public"."themes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theme_likes" ADD CONSTRAINT "theme_likes_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "themes" ADD CONSTRAINT "themes_maker_id_accounts_id_fk" FOREIGN KEY ("maker_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "compat_reports_title_id_platform_created_at_index" ON "compat_reports" USING btree ("title_id","platform","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "compat_reports_account_id_index" ON "compat_reports" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "compat_summaries_tested_at_index" ON "compat_summaries" USING btree ("tested_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "compat_summaries_platform_status_index" ON "compat_summaries" USING btree ("platform","status");--> statement-breakpoint
CREATE INDEX "theme_likes_account_id_index" ON "theme_likes" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "themes_maker_id_index" ON "themes" USING btree ("maker_id");--> statement-breakpoint
CREATE INDEX "themes_new" ON "themes" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "themes_popular" ON "themes" USING btree ("status","downloads" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "themes_liked" ON "themes" USING btree ("status","likes" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "theme_source" ON "themes" USING btree ("maker_id","source_id");