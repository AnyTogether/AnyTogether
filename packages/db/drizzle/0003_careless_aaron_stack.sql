CREATE TABLE "handle_history" (
	"handle" "citext" PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"released_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "handle_history" ADD CONSTRAINT "handle_history_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "handle_history_account_id_index" ON "handle_history" USING btree ("account_id");