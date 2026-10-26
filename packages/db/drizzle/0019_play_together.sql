ALTER TABLE "join_codes" DROP CONSTRAINT "join_code_kind";--> statement-breakpoint
ALTER TABLE "game_sessions" ADD COLUMN "kind" text DEFAULT 'online' NOT NULL;--> statement-breakpoint
ALTER TABLE "game_sessions" ADD COLUMN "party_id" uuid;--> statement-breakpoint
ALTER TABLE "game_sessions" ADD COLUMN "version_rule" text DEFAULT 'exact' NOT NULL;--> statement-breakpoint
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "one_lan_session_per_party" ON "game_sessions" USING btree ("party_id") WHERE "game_sessions"."ended_at" is null and "game_sessions"."kind" = 'lan';--> statement-breakpoint
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_session_kind" CHECK ("game_sessions"."kind" in ('online', 'lan', 'local'));--> statement-breakpoint
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_session_version_rule" CHECK ("game_sessions"."version_rule" in ('exact', 'major', 'any'));--> statement-breakpoint
ALTER TABLE "join_codes" ADD CONSTRAINT "join_code_kind" CHECK ("join_codes"."kind" in ('party', 'share_play', 'game_session'));