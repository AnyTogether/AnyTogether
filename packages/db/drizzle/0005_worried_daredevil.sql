CREATE TABLE "bans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid,
	"email_hash" "bytea",
	"reason" text,
	"created_by" text,
	"expires_at" timestamp with time zone,
	"lifted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reporter_id" uuid,
	"target_kind" text NOT NULL,
	"target_id" text NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'open' NOT NULL,
	"handled_by" text,
	"handled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_status" CHECK ("reports"."status" in ('open', 'actioned', 'dismissed')),
	CONSTRAINT "report_note" CHECK (length("reports"."note") <= 500)
);
--> statement-breakpoint
ALTER TABLE "bans" ADD CONSTRAINT "bans_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_accounts_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bans_account_id_index" ON "bans" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "bans_email_hash_index" ON "bans" USING btree ("email_hash");--> statement-breakpoint
CREATE INDEX "reports_status_created_at_index" ON "reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "reports_target_kind_target_id_index" ON "reports" USING btree ("target_kind","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "one_open_report" ON "reports" USING btree ("reporter_id","target_kind","target_id") WHERE "reports"."status" = 'open';