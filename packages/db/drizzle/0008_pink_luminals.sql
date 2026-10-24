CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"section" text NOT NULL,
	"title_id" text,
	"subject_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_kind" CHECK ("activities"."kind" in ('trophy', 'platinum', 'first_play', 'long_session', 'friendship', 'milestone')),
	CONSTRAINT "activity_section" CHECK ("activities"."section" in ('library', 'trophies', 'friends'))
);
--> statement-breakpoint
CREATE TABLE "activity_reactions" (
	"activity_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"reaction" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_reactions_activity_id_account_id_pk" PRIMARY KEY("activity_id","account_id"),
	CONSTRAINT "reaction" CHECK ("activity_reactions"."reaction" in ('fire', 'clap', 'wow', 'heart'))
);
--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_actor_id_accounts_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_title_id_games_title_id_fk" FOREIGN KEY ("title_id") REFERENCES "public"."games"("title_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_subject_id_accounts_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_reactions" ADD CONSTRAINT "activity_reactions_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_reactions" ADD CONSTRAINT "activity_reactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activities_actor" ON "activities" USING btree ("actor_id","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "activities_subject_id_index" ON "activities" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "activity_reactions_account_id_index" ON "activity_reactions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "earned_flagged" ON "earned_trophies" USING btree ("account_id","title_id") WHERE "earned_trophies"."flagged";--> statement-breakpoint
CREATE INDEX "library_by_points" ON "library" USING btree ("title_id","points" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "library_by_time" ON "library" USING btree ("title_id","seconds_played" DESC NULLS LAST);