CREATE TABLE "calls" (
	"id" uuid PRIMARY KEY NOT NULL,
	"party_id" uuid,
	"started_by" uuid,
	"callee_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "conversation_members" (
	"conversation_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"read_seq" bigint DEFAULT 0 NOT NULL,
	"muted" boolean DEFAULT false NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_members_conversation_id_account_id_pk" PRIMARY KEY("conversation_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"title" text,
	"direct_key" text,
	"created_by" uuid,
	"last_seq" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_directKey_unique" UNIQUE("direct_key"),
	CONSTRAINT "kind" CHECK ("conversations"."kind" in ('direct', 'group')),
	CONSTRAINT "direct_key" CHECK (("conversations"."kind" = 'direct') = ("conversations"."direct_key" is not null))
);
--> statement-breakpoint
CREATE TABLE "game_session_invites" (
	"session_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"invited_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_session_invites_session_id_account_id_pk" PRIMARY KEY("session_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "game_session_players" (
	"session_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_session_players_session_id_account_id_pk" PRIMARY KEY("session_id","account_id"),
	CONSTRAINT "game_session_players_accountId_unique" UNIQUE("account_id")
);
--> statement-breakpoint
CREATE TABLE "game_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"host_id" uuid NOT NULL,
	"title_id" text NOT NULL,
	"game_version" text NOT NULL,
	"engine_build" text NOT NULL,
	"capacity" integer NOT NULL,
	"joinable" boolean DEFAULT true NOT NULL,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "capacity" CHECK ("game_sessions"."capacity" between 2 and 16)
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"conversation_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"id" uuid NOT NULL,
	"author_id" uuid,
	"text" text,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reply_to" bigint,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_conversation_id_seq_pk" PRIMARY KEY("conversation_id","seq"),
	CONSTRAINT "messages_id_unique" UNIQUE("id"),
	CONSTRAINT "text_length" CHECK (length("messages"."text") <= 4000)
);
--> statement-breakpoint
CREATE TABLE "parties" (
	"id" uuid PRIMARY KEY NOT NULL,
	"leader_id" uuid,
	"privacy" text DEFAULT 'invite' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "privacy" CHECK ("parties"."privacy" in ('invite', 'friends'))
);
--> statement-breakpoint
CREATE TABLE "party_invites" (
	"party_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"invited_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "party_invites_party_id_account_id_pk" PRIMARY KEY("party_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "party_members" (
	"party_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "party_members_party_id_account_id_pk" PRIMARY KEY("party_id","account_id"),
	CONSTRAINT "party_members_accountId_unique" UNIQUE("account_id")
);
--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_started_by_accounts_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_callee_id_accounts_id_fk" FOREIGN KEY ("callee_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_session_invites" ADD CONSTRAINT "game_session_invites_session_id_game_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."game_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_session_invites" ADD CONSTRAINT "game_session_invites_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_session_invites" ADD CONSTRAINT "game_session_invites_invited_by_accounts_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_session_players" ADD CONSTRAINT "game_session_players_session_id_game_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."game_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_session_players" ADD CONSTRAINT "game_session_players_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_host_id_accounts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_title_id_games_title_id_fk" FOREIGN KEY ("title_id") REFERENCES "public"."games"("title_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_author_id_accounts_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_leader_id_accounts_id_fk" FOREIGN KEY ("leader_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_invites" ADD CONSTRAINT "party_invites_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_invites" ADD CONSTRAINT "party_invites_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_invites" ADD CONSTRAINT "party_invites_invited_by_accounts_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_members" ADD CONSTRAINT "party_members_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_members" ADD CONSTRAINT "party_members_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "one_call_per_party" ON "calls" USING btree ("party_id") WHERE "calls"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "calls_callee_id_index" ON "calls" USING btree ("callee_id");--> statement-breakpoint
CREATE INDEX "conversation_members_account_id_index" ON "conversation_members" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "game_session_invites_account_id_index" ON "game_session_invites" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "one_open_session_per_host" ON "game_sessions" USING btree ("host_id") WHERE "game_sessions"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "party_invites_account_id_index" ON "party_invites" USING btree ("account_id");