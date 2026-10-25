CREATE TABLE "appeals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"ban_id" uuid,
	"text" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"reply" text,
	"handled_by" text,
	"handled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appeal_status" CHECK ("appeals"."status" in ('open', 'accepted', 'declined')),
	CONSTRAINT "appeal_text" CHECK (length("appeals"."text") between 1 and 2000),
	CONSTRAINT "appeal_reply" CHECK (length("appeals"."reply") <= 1000)
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"account_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"name" text,
	"username" text,
	"hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connections_account_id_provider_pk" PRIMARY KEY("account_id","provider"),
	CONSTRAINT "connection_provider" CHECK ("connections"."provider" in ('steam', 'discord'))
);
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notification_kind";--> statement-breakpoint
ALTER TABLE "bans" ADD COLUMN "kind" text DEFAULT 'ban' NOT NULL;--> statement-breakpoint
ALTER TABLE "bans" ADD COLUMN "public_reason" text;--> statement-breakpoint
ALTER TABLE "handle_history" ADD COLUMN "skeleton" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "handle_skeleton" text;--> statement-breakpoint
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_ban_id_bans_id_fk" FOREIGN KEY ("ban_id") REFERENCES "public"."bans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appeals_account_id_created_at_index" ON "appeals" USING btree ("account_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "appeals_status_created_at_index" ON "appeals" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "one_open_appeal" ON "appeals" USING btree ("account_id") WHERE "appeals"."status" = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX "one_account_per_connection" ON "connections" USING btree ("provider","external_id");--> statement-breakpoint
CREATE INDEX "handle_history_skeleton_index" ON "handle_history" USING btree ("skeleton");--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_handle_skeleton" ON "profiles" USING btree ("handle_skeleton");--> statement-breakpoint
ALTER TABLE "bans" ADD CONSTRAINT "ban_kind" CHECK ("bans"."kind" in ('ban', 'mute'));--> statement-breakpoint
ALTER TABLE "bans" ADD CONSTRAINT "ban_public_reason" CHECK (length("bans"."public_reason") <= 300);--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notification_kind" CHECK ("notifications"."kind" in ('friend_request', 'friend_accepted', 'message', 'party_invite', 'game_invite', 'missed_call', 'lfg_request', 'lfg_accepted', 'warning', 'family_invite', 'family_request', 'family_answer', 'family_alert', 'family_summary', 'appeal'));--> statement-breakpoint
-- Existing handles get their skeleton (handleSkeleton in packages/shared, the same for a-z 0-9 _ .);
-- of handles that already looked alike, the oldest account keeps it and the others keep none.
UPDATE "profiles" p SET "handle_skeleton" = s.skeleton FROM (
	SELECT x.account_id, x.skeleton, row_number() OVER (PARTITION BY x.skeleton ORDER BY a.created_at, x.account_id) n
	FROM (SELECT account_id, replace(replace(replace(translate(lower(handle::text), '01i5._', 'olls'), 'rn', 'm'), 'vv', 'w'), 'cl', 'd') skeleton FROM "profiles") x
	JOIN "accounts" a ON a.id = x.account_id
) s WHERE s.account_id = p.account_id AND s.n = 1;--> statement-breakpoint
UPDATE "handle_history" SET "skeleton" = replace(replace(replace(translate(lower(handle::text), '01i5._', 'olls'), 'rn', 'm'), 'vv', 'w'), 'cl', 'd');
