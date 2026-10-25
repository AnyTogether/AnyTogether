CREATE TABLE "child_restrictions" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "families" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_by" uuid,
	"summary_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "family_name" CHECK (length("families"."name") <= 40)
);
--> statement-breakpoint
CREATE TABLE "family_invites" (
	"id" uuid PRIMARY KEY NOT NULL,
	"family_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"account_id" uuid,
	"role" text NOT NULL,
	"code_hash" "bytea",
	"invited_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "family_invites_codeHash_unique" UNIQUE("code_hash"),
	CONSTRAINT "family_invite_kind" CHECK ("family_invites"."kind" in ('member', 'child_link')),
	CONSTRAINT "family_invite_role" CHECK ("family_invites"."role" in ('parent', 'adult', 'child'))
);
--> statement-breakpoint
CREATE TABLE "family_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"family_id" uuid NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"subject_id" uuid,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "family_members" (
	"family_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"role" text NOT NULL,
	"added_by" uuid,
	"confirmed_at" timestamp with time zone,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "family_members_family_id_account_id_pk" PRIMARY KEY("family_id","account_id"),
	CONSTRAINT "family_members_accountId_unique" UNIQUE("account_id"),
	CONSTRAINT "family_role" CHECK ("family_members"."role" in ('manager', 'parent', 'adult', 'child'))
);
--> statement-breakpoint
CREATE TABLE "family_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"family_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"day" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"granted_minutes" integer,
	"answered_by" uuid,
	"answered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "family_request_kind" CHECK ("family_requests"."kind" in ('more_time', 'add_friend', 'play_game')),
	CONSTRAINT "family_request_status" CHECK ("family_requests"."status" in ('pending', 'approved', 'declined'))
);
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notification_kind";--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "age_levels" jsonb;--> statement-breakpoint
ALTER TABLE "child_restrictions" ADD CONSTRAINT "child_restrictions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "child_restrictions" ADD CONSTRAINT "child_restrictions_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "families" ADD CONSTRAINT "families_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_invites" ADD CONSTRAINT "family_invites_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_invites" ADD CONSTRAINT "family_invites_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_invites" ADD CONSTRAINT "family_invites_invited_by_accounts_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_log" ADD CONSTRAINT "family_log_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_log" ADD CONSTRAINT "family_log_actor_id_accounts_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_log" ADD CONSTRAINT "family_log_subject_id_accounts_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_added_by_accounts_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_requests" ADD CONSTRAINT "family_requests_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_requests" ADD CONSTRAINT "family_requests_child_id_accounts_id_fk" FOREIGN KEY ("child_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_requests" ADD CONSTRAINT "family_requests_answered_by_accounts_id_fk" FOREIGN KEY ("answered_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "family_invites_account_id_index" ON "family_invites" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "family_invites_family_id_index" ON "family_invites" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "family_log_by_family" ON "family_log" USING btree ("family_id","id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "one_family_manager" ON "family_members" USING btree ("family_id") WHERE "family_members"."role" = 'manager';--> statement-breakpoint
CREATE INDEX "family_requests_family_id_status_index" ON "family_requests" USING btree ("family_id","status");--> statement-breakpoint
CREATE INDEX "family_requests_child_id_day_index" ON "family_requests" USING btree ("child_id","day");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notification_kind" CHECK ("notifications"."kind" in ('friend_request', 'friend_accepted', 'message', 'party_invite', 'game_invite', 'missed_call', 'lfg_request', 'lfg_accepted', 'warning', 'family_invite', 'family_request', 'family_answer', 'family_alert', 'family_summary'));