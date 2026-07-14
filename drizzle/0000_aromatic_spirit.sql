CREATE TABLE "account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_metadata" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"must_change_password" boolean DEFAULT true NOT NULL,
	"locale" varchar(16) DEFAULT 'zh-CN' NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "admin_metadata_locale_supported" CHECK ("admin_metadata"."locale" in ('zh-CN', 'en'))
);
--> statement-breakpoint
CREATE TABLE "rate_limit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limit_count_nonnegative" CHECK ("rate_limit"."count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	"impersonated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"role" text,
	"banned" boolean DEFAULT false,
	"ban_reason" text,
	"ban_expires" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"version_number" varchar(20) NOT NULL,
	"version_major" integer NOT NULL,
	"version_minor" integer NOT NULL,
	"version_patch" integer NOT NULL,
	"description" varchar(1024) NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "application_versions_major_nonnegative" CHECK ("application_versions"."version_major" >= 0),
	CONSTRAINT "application_versions_minor_nonnegative" CHECK ("application_versions"."version_minor" >= 0),
	CONSTRAINT "application_versions_patch_nonnegative" CHECK ("application_versions"."version_patch" >= 0),
	CONSTRAINT "application_versions_number_canonical" CHECK ("application_versions"."version_number" = ("application_versions"."version_major"::text || '.' || "application_versions"."version_minor"::text || '.' || "application_versions"."version_patch"::text)),
	CONSTRAINT "application_versions_row_version_positive" CHECK ("application_versions"."row_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(128) NOT NULL,
	"description" varchar(512),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "applications_row_version_positive" CHECK ("applications"."row_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "file_metadata" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"path" varchar(1024) NOT NULL,
	"sha256" char(64) NOT NULL,
	"size" bigint NOT NULL,
	"object_key" varchar(1024) NOT NULL,
	"mime_type" varchar(255) NOT NULL,
	"etag" varchar(255),
	"checksum_algorithm" varchar(16) DEFAULT 'sha256' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "file_metadata_size_nonnegative" CHECK ("file_metadata"."size" >= 0),
	CONSTRAINT "file_metadata_sha256_format" CHECK ("file_metadata"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "file_metadata_checksum_algorithm" CHECK ("file_metadata"."checksum_algorithm" = 'sha256'),
	CONSTRAINT "file_metadata_row_version_positive" CHECK ("file_metadata"."row_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "version_files" (
	"version_id" uuid NOT NULL,
	"file_metadata_id" uuid NOT NULL,
	CONSTRAINT "version_files_pk" PRIMARY KEY("version_id","file_metadata_id")
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" varchar(128) NOT NULL,
	"resource_type" varchar(64) NOT NULL,
	"resource_id" varchar(128) NOT NULL,
	"result" varchar(32) NOT NULL,
	"before_json" jsonb,
	"after_json" jsonb,
	"request_id" varchar(128) NOT NULL,
	"ip" varchar(64),
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit_windows" (
	"endpoint" varchar(255) NOT NULL,
	"subject_key" varchar(255) NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rate_limit_windows_pk" PRIMARY KEY("endpoint","subject_key","window_started_at"),
	CONSTRAINT "rate_limit_windows_count_nonnegative" CHECK ("rate_limit_windows"."count" >= 0),
	CONSTRAINT "rate_limit_windows_expiry_after_start" CHECK ("rate_limit_windows"."expires_at" > "rate_limit_windows"."window_started_at")
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"system_name" varchar(128) DEFAULT '版本管理系统' NOT NULL,
	"default_locale" varchar(16) DEFAULT 'zh-CN' NOT NULL,
	"default_page_size" integer DEFAULT 20 NOT NULL,
	"repository_url" varchar(2048),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "system_settings_singleton" CHECK ("system_settings"."id" = 1),
	CONSTRAINT "system_settings_locale_supported" CHECK ("system_settings"."default_locale" in ('zh-CN', 'en')),
	CONSTRAINT "system_settings_page_size_supported" CHECK ("system_settings"."default_page_size" in (20, 50, 100)),
	CONSTRAINT "system_settings_row_version_positive" CHECK ("system_settings"."row_version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_metadata" ADD CONSTRAINT "admin_metadata_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_versions" ADD CONSTRAINT "application_versions_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "version_files" ADD CONSTRAINT "version_files_version_id_application_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."application_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "version_files" ADD CONSTRAINT "version_files_file_metadata_id_file_metadata_id_fk" FOREIGN KEY ("file_metadata_id") REFERENCES "public"."file_metadata"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_provider_account_unique" ON "account" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rate_limit_key_unique" ON "rate_limit" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "session_token_unique" ON "session" USING btree ("token");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_unique" ON "user" USING btree ("email");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "application_versions_live_number_unique" ON "application_versions" USING btree ("application_id","version_major","version_minor","version_patch") WHERE "application_versions"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "application_versions_latest_idx" ON "application_versions" USING btree ("application_id","is_active","version_major" DESC NULLS LAST,"version_minor" DESC NULLS LAST,"version_patch" DESC NULLS LAST) WHERE "application_versions"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "applications_live_name_unique" ON "applications" USING btree ("name") WHERE "applications"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "file_metadata_live_identity_unique" ON "file_metadata" USING btree ("path","sha256","size") WHERE "file_metadata"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "file_metadata_object_key_idx" ON "file_metadata" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "file_metadata_sha256_idx" ON "file_metadata" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "audit_events_created_at_idx" ON "audit_events" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_events_actor_created_at_idx" ON "audit_events" USING btree ("actor_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_events_action_created_at_idx" ON "audit_events" USING btree ("action","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_events_resource_created_at_idx" ON "audit_events" USING btree ("resource_type","resource_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_events_result_created_at_idx" ON "audit_events" USING btree ("result","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "rate_limit_windows_expires_at_idx" ON "rate_limit_windows" USING btree ("expires_at");