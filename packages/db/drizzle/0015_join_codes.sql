CREATE TABLE "join_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"target_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "join_code_kind" CHECK ("join_codes"."kind" in ('party', 'share_play'))
);
--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "discord_url" text;--> statement-breakpoint
ALTER TABLE "join_codes" ADD CONSTRAINT "join_codes_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "join_codes_target" ON "join_codes" USING btree ("kind","target_id") WHERE "join_codes"."revoked_at" is null;