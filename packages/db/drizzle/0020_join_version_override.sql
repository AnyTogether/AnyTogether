ALTER TABLE "game_session_players" ADD COLUMN "game_version" text;--> statement-breakpoint
ALTER TABLE "game_session_players" ADD COLUMN "version_override" boolean DEFAULT false NOT NULL;