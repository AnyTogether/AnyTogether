CREATE TABLE "push_devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"token" text NOT NULL,
	"app" text,
	"sandbox" boolean DEFAULT false NOT NULL,
	"lang" text DEFAULT 'en' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_devices_token_unique" UNIQUE("token"),
	CONSTRAINT "push_device_platform" CHECK ("push_devices"."platform" in ('apns', 'fcm'))
);
--> statement-breakpoint
ALTER TABLE "push_devices" ADD CONSTRAINT "push_devices_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_devices" ADD CONSTRAINT "push_devices_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_devices_account_id_index" ON "push_devices" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "push_devices_session_id_index" ON "push_devices" USING btree ("session_id");