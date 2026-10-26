ALTER TABLE "compat_reports" ADD COLUMN "online" text;--> statement-breakpoint
ALTER TABLE "compat_summaries" ADD COLUMN "online" text;--> statement-breakpoint
ALTER TABLE "compat_reports" ADD CONSTRAINT "compat_online" CHECK ("compat_reports"."online" in ('works', 'broken'));