CREATE TABLE "post_comments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"post_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"parent_id" uuid,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_comment_text" CHECK (length("post_comments"."text") between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "post_likes" (
	"post_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_likes_post_id_account_id_pk" PRIMARY KEY("post_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "post_media" (
	"post_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "post_media_post_id_position_pk" PRIMARY KEY("post_id","position"),
	CONSTRAINT "post_media_position" CHECK ("post_media"."position" between 0 and 3)
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"author_id" uuid NOT NULL,
	"caption" text,
	"title_id" text,
	"visibility" text DEFAULT 'friends' NOT NULL,
	"comments_off" boolean DEFAULT false NOT NULL,
	"source" text,
	"status" text DEFAULT 'active' NOT NULL,
	"edited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_visibility" CHECK ("posts"."visibility" in ('friends', 'public')),
	CONSTRAINT "post_status" CHECK ("posts"."status" in ('active', 'removed')),
	CONSTRAINT "post_source" CHECK ("posts"."source" in ('web', 'launcher', 'phone')),
	CONSTRAINT "post_caption" CHECK (length("posts"."caption") <= 500)
);
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notification_kind";--> statement-breakpoint
ALTER TABLE "post_comments" ADD CONSTRAINT "post_comments_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_comments" ADD CONSTRAINT "post_comments_author_id_accounts_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_comments" ADD CONSTRAINT "post_comments_parent_id_post_comments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."post_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_media" ADD CONSTRAINT "post_media_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_media" ADD CONSTRAINT "post_media_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_author_id_accounts_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "post_comments_by_post" ON "post_comments" USING btree ("post_id","parent_id","id");--> statement-breakpoint
CREATE INDEX "post_comments_author_id_index" ON "post_comments" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "post_likes_account_id_index" ON "post_likes" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "post_media_media_id_index" ON "post_media" USING btree ("media_id");--> statement-breakpoint
CREATE INDEX "posts_by_author" ON "posts" USING btree ("author_id","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "posts_by_game" ON "posts" USING btree ("title_id","id" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notification_kind" CHECK ("notifications"."kind" in ('friend_request', 'friend_accepted', 'message', 'party_invite', 'game_invite', 'missed_call', 'lfg_request', 'lfg_accepted', 'warning', 'family_invite', 'family_request', 'family_answer', 'family_alert', 'family_summary', 'appeal', 'level_up', 'community_invite', 'event_reminder', 'event_started', 'post_like', 'post_comment', 'comment_reply'));