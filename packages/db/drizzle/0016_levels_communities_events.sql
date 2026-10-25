CREATE TABLE "communities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"title_id" text,
	"description" text,
	"icon" text NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"owner_id" uuid,
	"member_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_visibility" CHECK ("communities"."visibility" in ('public', 'invite')),
	CONSTRAINT "community_name" CHECK (length("communities"."name") between 3 and 40),
	CONSTRAINT "community_description" CHECK (length("communities"."description") <= 500)
);
--> statement-breakpoint
CREATE TABLE "community_bans" (
	"community_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"banned_by" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_bans_community_id_account_id_pk" PRIMARY KEY("community_id","account_id"),
	CONSTRAINT "community_ban_reason" CHECK (length("community_bans"."reason") <= 200)
);
--> statement-breakpoint
CREATE TABLE "community_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"community_id" uuid NOT NULL,
	"host_id" uuid,
	"title" text NOT NULL,
	"title_id" text,
	"description" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"reminded_at" timestamp with time zone,
	"link" jsonb,
	"started_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_status" CHECK ("community_events"."status" in ('scheduled', 'cancelled')),
	CONSTRAINT "event_title" CHECK (length("community_events"."title") between 3 and 80),
	CONSTRAINT "event_description" CHECK (length("community_events"."description") <= 1000),
	CONSTRAINT "event_ends_after_starts" CHECK ("community_events"."ends_at" > "community_events"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "community_invites" (
	"community_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"invited_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_invites_community_id_account_id_pk" PRIMARY KEY("community_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "community_members" (
	"community_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_members_community_id_account_id_pk" PRIMARY KEY("community_id","account_id"),
	CONSTRAINT "community_role" CHECK ("community_members"."role" in ('owner', 'moderator', 'member'))
);
--> statement-breakpoint
CREATE TABLE "event_rsvps" (
	"event_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_rsvps_event_id_account_id_pk" PRIMARY KEY("event_id","account_id"),
	CONSTRAINT "rsvp_status" CHECK ("event_rsvps"."status" in ('going', 'maybe'))
);
--> statement-breakpoint
CREATE TABLE "met_players" (
	"account_id" uuid NOT NULL,
	"other_id" uuid NOT NULL,
	"source" text NOT NULL,
	"title_id" text,
	"times" integer DEFAULT 1 NOT NULL,
	"first_met_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_met_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "met_players_account_id_other_id_pk" PRIMARY KEY("account_id","other_id"),
	CONSTRAINT "met_source" CHECK ("met_players"."source" in ('party', 'share_play', 'game_session', 'lfg')),
	CONSTRAINT "met_not_self" CHECK ("met_players"."account_id" <> "met_players"."other_id")
);
--> statement-breakpoint
ALTER TABLE "activities" DROP CONSTRAINT "activity_kind";--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notification_kind";--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "community_id" uuid;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "trophy_points" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "trophy_level" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "showcase" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "cover" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "accent" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "remember_met" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "communities_title_id_games_title_id_fk" FOREIGN KEY ("title_id") REFERENCES "public"."games"("title_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "communities_owner_id_accounts_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_bans" ADD CONSTRAINT "community_bans_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_bans" ADD CONSTRAINT "community_bans_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_bans" ADD CONSTRAINT "community_bans_banned_by_accounts_id_fk" FOREIGN KEY ("banned_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_events" ADD CONSTRAINT "community_events_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_events" ADD CONSTRAINT "community_events_host_id_accounts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_events" ADD CONSTRAINT "community_events_title_id_games_title_id_fk" FOREIGN KEY ("title_id") REFERENCES "public"."games"("title_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_invites" ADD CONSTRAINT "community_invites_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_invites" ADD CONSTRAINT "community_invites_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_invites" ADD CONSTRAINT "community_invites_invited_by_accounts_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_members" ADD CONSTRAINT "community_members_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_members" ADD CONSTRAINT "community_members_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_rsvps" ADD CONSTRAINT "event_rsvps_event_id_community_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."community_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_rsvps" ADD CONSTRAINT "event_rsvps_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "met_players" ADD CONSTRAINT "met_players_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "met_players" ADD CONSTRAINT "met_players_other_id_accounts_id_fk" FOREIGN KEY ("other_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "met_players" ADD CONSTRAINT "met_players_title_id_games_title_id_fk" FOREIGN KEY ("title_id") REFERENCES "public"."games"("title_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "communities_public" ON "communities" USING btree ("visibility","member_count" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "communities_title_id_index" ON "communities" USING btree ("title_id");--> statement-breakpoint
CREATE INDEX "communities_owner_id_index" ON "communities" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "events_by_community" ON "community_events" USING btree ("community_id","starts_at");--> statement-breakpoint
CREATE INDEX "events_due" ON "community_events" USING btree ("starts_at") WHERE "community_events"."status" = 'scheduled' and "community_events"."reminded_at" is null;--> statement-breakpoint
CREATE INDEX "community_invites_account_id_index" ON "community_invites" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "community_members_account_id_index" ON "community_members" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "event_rsvps_account_id_index" ON "event_rsvps" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "met_by_account" ON "met_players" USING btree ("account_id","last_met_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "met_by_time" ON "met_players" USING btree ("last_met_at");--> statement-breakpoint
CREATE INDEX "met_players_other_id_index" ON "met_players" USING btree ("other_id");--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "profiles_by_level" ON "profiles" USING btree ("trophy_level" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_communityId_unique" UNIQUE("community_id");--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activity_kind" CHECK ("activities"."kind" in ('trophy', 'platinum', 'first_play', 'long_session', 'friendship', 'milestone', 'level_up'));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notification_kind" CHECK ("notifications"."kind" in ('friend_request', 'friend_accepted', 'message', 'party_invite', 'game_invite', 'missed_call', 'lfg_request', 'lfg_accepted', 'warning', 'family_invite', 'family_request', 'family_answer', 'family_alert', 'family_summary', 'appeal', 'level_up', 'community_invite', 'event_reminder', 'event_started'));--> statement-breakpoint
-- Trophy points and levels for everyone who has trophies already (level:begin/end: the curve, as
-- trophyLevelSql in packages/shared/src/level.ts writes it).
UPDATE "profiles" p SET "trophy_points" = t.points, "trophy_level" =
-- level:begin
(case when t.points < 5940 then 1 + (t.points - 0) / 60 when t.points < 14940 then 100 + (t.points - 5940) / 90 when t.points < 59940 then 200 + (t.points - 14940) / 450 when t.points < 149940 then 300 + (t.points - 59940) / 900 when t.points < 284940 then 400 + (t.points - 149940) / 1350 when t.points < 464940 then 500 + (t.points - 284940) / 1800 when t.points < 689940 then 600 + (t.points - 464940) / 2250 when t.points < 959940 then 700 + (t.points - 689940) / 2700 when t.points < 1274940 then 800 + (t.points - 959940) / 3150 when t.points < 1631340 then 900 + (t.points - 1274940) / 3600 else 999 end)
-- level:end
FROM (SELECT "account_id", coalesce(sum("points"), 0)::int points FROM "library" GROUP BY "account_id") t
WHERE t."account_id" = p."account_id";
