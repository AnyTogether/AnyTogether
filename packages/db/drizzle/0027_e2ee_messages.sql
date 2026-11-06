CREATE TABLE "e2ee_devices" (
	"account_id" uuid NOT NULL,
	"id" text NOT NULL,
	"sign_key" text NOT NULL,
	"box_key" text NOT NULL,
	"sig" text NOT NULL,
	"name" text NOT NULL,
	"session_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "e2ee_devices_account_id_id_pk" PRIMARY KEY("account_id","id"),
	CONSTRAINT "e2ee_device_name" CHECK (length("e2ee_devices"."name") <= 80)
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "sealed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "sealed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "sealed" jsonb;--> statement-breakpoint
ALTER TABLE "e2ee_devices" ADD CONSTRAINT "e2ee_devices_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "e2ee_devices" ADD CONSTRAINT "e2ee_devices_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "e2ee_devices_session_id_index" ON "e2ee_devices" USING btree ("session_id");--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "sealed_direct" CHECK ("conversations"."sealed_at" is null or "conversations"."kind" = 'direct');--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "sealed_text" CHECK ("messages"."sealed" is null or "messages"."text" is null);