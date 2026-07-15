ALTER TABLE "roles" ADD COLUMN "code" varchar(64) NOT NULL;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_code_unique" UNIQUE("code");