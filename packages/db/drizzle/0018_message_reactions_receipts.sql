CREATE TABLE "message_reactions" (
	"conversation_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"account_id" uuid NOT NULL,
	"reaction" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_reactions_conversation_id_seq_account_id_reaction_pk" PRIMARY KEY("conversation_id","seq","account_id","reaction"),
	CONSTRAINT "reaction" CHECK ("message_reactions"."reaction" in ('like', 'love', 'laugh', 'wow', 'sad', 'fire', 'gg'))
);
--> statement-breakpoint
ALTER TABLE "conversation_members" ADD COLUMN "delivered_seq" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_members" ADD COLUMN "pinned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "edit_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "read_receipts" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_conversation_id_seq_messages_conversation_id_seq_fk" FOREIGN KEY ("conversation_id","seq") REFERENCES "public"."messages"("conversation_id","seq") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_reactions_account_id_index" ON "message_reactions" USING btree ("account_id");--> statement-breakpoint
UPDATE "conversation_members" SET "delivered_seq" = "read_seq";