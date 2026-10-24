CREATE TABLE "lfg_posts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"author_id" uuid NOT NULL,
	"title_id" text NOT NULL,
	"purpose" text NOT NULL,
	"starts_at" timestamp with time zone,
	"languages" jsonb NOT NULL,
	"region" text,
	"slots" integer NOT NULL,
	"filled" integer DEFAULT 0 NOT NULL,
	"note" text,
	"status" text DEFAULT 'open' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lfg_purpose" CHECK ("lfg_posts"."purpose" in ('coop', 'online', 'party', 'trophies')),
	CONSTRAINT "lfg_status" CHECK ("lfg_posts"."status" in ('open', 'full', 'closed', 'expired', 'removed')),
	CONSTRAINT "lfg_slots" CHECK ("lfg_posts"."slots" between 1 and 7 and "lfg_posts"."filled" between 0 and "lfg_posts"."slots"),
	CONSTRAINT "lfg_note" CHECK (length("lfg_posts"."note") <= 140)
);
--> statement-breakpoint
CREATE TABLE "lfg_requests" (
	"post_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"invite" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone,
	CONSTRAINT "lfg_requests_post_id_account_id_pk" PRIMARY KEY("post_id","account_id"),
	CONSTRAINT "lfg_request_status" CHECK ("lfg_requests"."status" in ('pending', 'accepted', 'declined'))
);
--> statement-breakpoint
CREATE TABLE "party_requests" (
	"party_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "party_requests_party_id_account_id_pk" PRIMARY KEY("party_id","account_id")
);
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notification_kind";--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "public_join" text;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "title_id" text;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "language" text;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "listed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "discoverable" boolean;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "languages" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "lfg_posts" ADD CONSTRAINT "lfg_posts_author_id_accounts_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lfg_posts" ADD CONSTRAINT "lfg_posts_title_id_games_title_id_fk" FOREIGN KEY ("title_id") REFERENCES "public"."games"("title_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lfg_requests" ADD CONSTRAINT "lfg_requests_post_id_lfg_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."lfg_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lfg_requests" ADD CONSTRAINT "lfg_requests_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_requests" ADD CONSTRAINT "party_requests_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_requests" ADD CONSTRAINT "party_requests_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lfg_open" ON "lfg_posts" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "lfg_by_game" ON "lfg_posts" USING btree ("title_id","status");--> statement-breakpoint
CREATE INDEX "lfg_posts_author_id_status_index" ON "lfg_posts" USING btree ("author_id","status");--> statement-breakpoint
CREATE INDEX "lfg_requests_account_id_created_at_index" ON "lfg_requests" USING btree ("account_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "party_requests_account_id_index" ON "party_requests" USING btree ("account_id");--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_title_id_games_title_id_fk" FOREIGN KEY ("title_id") REFERENCES "public"."games"("title_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "parties_listed" ON "parties" USING btree ("listed_at" DESC NULLS LAST) WHERE "parties"."public_join" is not null and "parties"."ended_at" is null;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notification_kind" CHECK ("notifications"."kind" in ('friend_request', 'friend_accepted', 'message', 'party_invite', 'game_invite', 'missed_call', 'lfg_request', 'lfg_accepted', 'warning'));--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "party_public_join" CHECK ("parties"."public_join" in ('request', 'open'));