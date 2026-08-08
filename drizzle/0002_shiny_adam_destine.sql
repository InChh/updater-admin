ALTER TABLE "application_versions" ADD COLUMN "lifecycle_status" varchar(16);--> statement-breakpoint
ALTER TABLE "application_versions" ADD COLUMN "expected_file_count" integer;--> statement-breakpoint
ALTER TABLE "application_versions" ADD COLUMN "finalized_at" timestamp with time zone;--> statement-breakpoint
UPDATE "application_versions" SET "lifecycle_status" = 'finalized', "finalized_at" = "created_at";--> statement-breakpoint
ALTER TABLE "application_versions" ALTER COLUMN "lifecycle_status" SET DEFAULT 'draft';--> statement-breakpoint
ALTER TABLE "application_versions" ALTER COLUMN "lifecycle_status" SET NOT NULL;--> statement-breakpoint
DROP INDEX "application_versions_latest_idx";--> statement-breakpoint
CREATE INDEX "application_versions_latest_idx" ON "application_versions" USING btree ("application_id","lifecycle_status","is_active","version_major" DESC NULLS LAST,"version_minor" DESC NULLS LAST,"version_patch" DESC NULLS LAST) WHERE "application_versions"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "application_versions" ADD CONSTRAINT "application_versions_lifecycle_status_supported" CHECK ("application_versions"."lifecycle_status" in ('draft', 'finalized'));--> statement-breakpoint
ALTER TABLE "application_versions" ADD CONSTRAINT "application_versions_expected_file_count_nonnegative" CHECK ("application_versions"."expected_file_count" is null or "application_versions"."expected_file_count" >= 0);--> statement-breakpoint
ALTER TABLE "application_versions" ADD CONSTRAINT "application_versions_draft_consistent" CHECK ("application_versions"."lifecycle_status" <> 'draft' or ("application_versions"."expected_file_count" is not null and "application_versions"."expected_file_count" > 0 and "application_versions"."is_active" = false and "application_versions"."finalized_at" is null));--> statement-breakpoint
ALTER TABLE "application_versions" ADD CONSTRAINT "application_versions_finalized_consistent" CHECK ("application_versions"."lifecycle_status" <> 'finalized' or "application_versions"."finalized_at" is not null);
