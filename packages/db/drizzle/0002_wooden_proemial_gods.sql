CREATE TABLE "earned_trophies" (
	"account_id" uuid NOT NULL,
	"title_id" text NOT NULL,
	"set_hash" text NOT NULL,
	"trophy_id" integer NOT NULL,
	"earned_at" timestamp with time zone NOT NULL,
	"flagged" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "earned_trophies_account_id_title_id_trophy_id_pk" PRIMARY KEY("account_id","title_id","trophy_id")
);
--> statement-breakpoint
CREATE TABLE "games" (
	"title_id" text PRIMARY KEY NOT NULL,
	"names" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"icon_url" text,
	"taught_by" uuid,
	"locked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "title_id" CHECK ("games"."title_id" ~ '^[A-Z]{4}[0-9]{5}$')
);
--> statement-breakpoint
CREATE TABLE "library" (
	"account_id" uuid NOT NULL,
	"title_id" text NOT NULL,
	"first_played_at" timestamp with time zone,
	"last_played_at" timestamp with time zone,
	"seconds_played" bigint DEFAULT 0 NOT NULL,
	"trophies_earned" integer DEFAULT 0 NOT NULL,
	"trophies_total" integer,
	"points" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "library_account_id_title_id_pk" PRIMARY KEY("account_id","title_id")
);
--> statement-breakpoint
CREATE TABLE "play_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"title_id" text NOT NULL,
	"device_id" uuid,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"exit" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ended_after_started" CHECK ("play_sessions"."ended_at" > "play_sessions"."started_at")
);
--> statement-breakpoint
CREATE TABLE "trophies" (
	"title_id" text NOT NULL,
	"set_hash" text NOT NULL,
	"trophy_id" integer NOT NULL,
	"grade" text NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"texts" jsonb NOT NULL,
	"earned_count" integer DEFAULT 0 NOT NULL,
	"rarity" real,
	CONSTRAINT "trophies_title_id_set_hash_trophy_id_pk" PRIMARY KEY("title_id","set_hash","trophy_id"),
	CONSTRAINT "grade" CHECK ("trophies"."grade" in ('bronze', 'silver', 'gold', 'platinum'))
);
--> statement-breakpoint
CREATE TABLE "trophy_sets" (
	"title_id" text NOT NULL,
	"set_hash" text NOT NULL,
	"taught_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trophy_sets_title_id_set_hash_pk" PRIMARY KEY("title_id","set_hash")
);
--> statement-breakpoint
ALTER TABLE "earned_trophies" ADD CONSTRAINT "earned_trophies_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "earned_trophies" ADD CONSTRAINT "earned_trophies_title_id_set_hash_trophy_id_trophies_title_id_set_hash_trophy_id_fk" FOREIGN KEY ("title_id","set_hash","trophy_id") REFERENCES "public"."trophies"("title_id","set_hash","trophy_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_taught_by_accounts_id_fk" FOREIGN KEY ("taught_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library" ADD CONSTRAINT "library_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library" ADD CONSTRAINT "library_title_id_games_title_id_fk" FOREIGN KEY ("title_id") REFERENCES "public"."games"("title_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "play_sessions" ADD CONSTRAINT "play_sessions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "play_sessions" ADD CONSTRAINT "play_sessions_title_id_games_title_id_fk" FOREIGN KEY ("title_id") REFERENCES "public"."games"("title_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "play_sessions" ADD CONSTRAINT "play_sessions_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trophies" ADD CONSTRAINT "trophies_title_id_set_hash_trophy_sets_title_id_set_hash_fk" FOREIGN KEY ("title_id","set_hash") REFERENCES "public"."trophy_sets"("title_id","set_hash") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trophy_sets" ADD CONSTRAINT "trophy_sets_title_id_games_title_id_fk" FOREIGN KEY ("title_id") REFERENCES "public"."games"("title_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trophy_sets" ADD CONSTRAINT "trophy_sets_taught_by_accounts_id_fk" FOREIGN KEY ("taught_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "earned_by_game" ON "earned_trophies" USING btree ("title_id","trophy_id");--> statement-breakpoint
CREATE INDEX "earned_trophies_account_id_earned_at_index" ON "earned_trophies" USING btree ("account_id","earned_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "library_title_id_index" ON "library" USING btree ("title_id");--> statement-breakpoint
CREATE INDEX "play_sessions_account_id_title_id_started_at_index" ON "play_sessions" USING btree ("account_id","title_id","started_at" DESC NULLS LAST);