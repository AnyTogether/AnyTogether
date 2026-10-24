CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" "citext",
	"role" text DEFAULT 'user' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"delete_after" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"target" text,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"name" text NOT NULL,
	"model" text,
	"last_seen_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "identities" (
	"account_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"subject" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "identities_provider_subject_pk" PRIMARY KEY("provider","subject")
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"handle" "citext" NOT NULL,
	"handle_changed_at" timestamp with time zone,
	"display_name" text NOT NULL,
	"bio" text,
	"country" text,
	"avatar_url" text,
	"privacy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "profiles_handle_unique" UNIQUE("handle"),
	CONSTRAINT "bio_length" CHECK (length("profiles"."bio") <= 160)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"client" text NOT NULL,
	"device_name" text,
	"refresh_hash" "bytea" NOT NULL,
	"previous_hash" "bytea",
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sign_in_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"email" "citext",
	"code_hash" "bytea",
	"link_hash" "bytea",
	"secret_hash" "bytea",
	"user_code" text,
	"client" text,
	"device_name" text,
	"approved_by" uuid,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_polled_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sign_in_requests_userCode_unique" UNIQUE("user_code"),
	CONSTRAINT "kind" CHECK ("sign_in_requests"."kind" in ('email', 'handoff', 'device'))
);
--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identities" ADD CONSTRAINT "identities_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sign_in_requests" ADD CONSTRAINT "sign_in_requests_approved_by_accounts_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "devices_account_id_index" ON "devices" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "identities_account_id_index" ON "identities" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "sessions_account_id_index" ON "sessions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "sessions_refresh_hash_index" ON "sessions" USING btree ("refresh_hash");--> statement-breakpoint
CREATE INDEX "sessions_previous_hash_index" ON "sessions" USING btree ("previous_hash");--> statement-breakpoint
CREATE INDEX "sign_in_requests_email_index" ON "sign_in_requests" USING btree ("email");