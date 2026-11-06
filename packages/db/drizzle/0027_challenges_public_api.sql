CREATE TABLE "api_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"start" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_tokens_tokenHash_unique" UNIQUE("token_hash"),
	CONSTRAINT "api_token_name" CHECK (length("api_tokens"."name") between 1 and 60)
);
--> statement-breakpoint
CREATE TABLE "challenge_entries" (
	"challenge_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"final_value" bigint,
	"final_rank" integer,
	CONSTRAINT "challenge_entries_challenge_id_account_id_pk" PRIMARY KEY("challenge_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "challenges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"creator_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"title_id" text NOT NULL,
	"metric" text NOT NULL,
	"audience" text NOT NULL,
	"community_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"started_notice_at" timestamp with time zone,
	"finalized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "challenge_metric" CHECK ("challenges"."metric" in ('points', 'trophies', 'time')),
	CONSTRAINT "challenge_audience" CHECK ("challenges"."audience" in ('friends', 'community', 'public')),
	CONSTRAINT "challenge_status" CHECK ("challenges"."status" in ('scheduled', 'cancelled')),
	CONSTRAINT "challenge_community" CHECK (("challenges"."audience" = 'community') = ("challenges"."community_id" is not null)),
	CONSTRAINT "challenge_title" CHECK (length("challenges"."title") between 3 and 80),
	CONSTRAINT "challenge_description" CHECK (length("challenges"."description") <= 500),
	CONSTRAINT "challenge_ends_after_starts" CHECK ("challenges"."ends_at" > "challenges"."starts_at")
);
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notification_kind";--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge_entries" ADD CONSTRAINT "challenge_entries_challenge_id_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge_entries" ADD CONSTRAINT "challenge_entries_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_creator_id_accounts_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_title_id_games_title_id_fk" FOREIGN KEY ("title_id") REFERENCES "public"."games"("title_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_tokens_account_id_index" ON "api_tokens" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "challenge_entries_account_id_index" ON "challenge_entries" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "challenges_by_audience" ON "challenges" USING btree ("audience","ends_at");--> statement-breakpoint
CREATE INDEX "challenges_by_game" ON "challenges" USING btree ("title_id","ends_at");--> statement-breakpoint
CREATE INDEX "challenges_community_id_index" ON "challenges" USING btree ("community_id");--> statement-breakpoint
CREATE INDEX "challenges_creator_id_index" ON "challenges" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "challenges_due" ON "challenges" USING btree ("ends_at") WHERE "challenges"."status" = 'scheduled' and "challenges"."finalized_at" is null;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notification_kind" CHECK ("notifications"."kind" in ('friend_request', 'friend_accepted', 'message', 'party_invite', 'game_invite', 'missed_call', 'lfg_request', 'lfg_accepted', 'warning', 'family_invite', 'family_request', 'family_answer', 'family_alert', 'family_summary', 'appeal', 'level_up', 'community_invite', 'event_reminder', 'event_started', 'post_like', 'post_comment', 'comment_reply', 'challenge_invite', 'challenge_started', 'challenge_ended'));