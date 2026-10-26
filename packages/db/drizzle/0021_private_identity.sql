ALTER TABLE "avatars" ADD COLUMN "private" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "private_name" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "private_avatar" text;