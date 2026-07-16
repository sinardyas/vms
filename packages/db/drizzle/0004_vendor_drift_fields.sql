CREATE TYPE "public"."company_scale" AS ENUM('kecil', 'menengah', 'besar');--> statement-breakpoint
CREATE TYPE "public"."npwp_type" AS ENUM('personal', 'head_office', 'branch');--> statement-breakpoint
CREATE TYPE "public"."tax_status" AS ENUM('pkp_corporate', 'pkp_individual', 'non_pkp_corporate', 'non_pkp_individual');--> statement-breakpoint
ALTER TABLE "vendor_banks" ADD COLUMN "description" varchar(200);--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "tax_status" "tax_status";--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "npwp_type" "npwp_type";--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "company_scale" "company_scale";--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "procurement_note" varchar(200);--> statement-breakpoint
ALTER TABLE "document_versions" ADD COLUMN "ref_no" varchar(120);--> statement-breakpoint
ALTER TABLE "document_versions" ADD COLUMN "variant" varchar(60);