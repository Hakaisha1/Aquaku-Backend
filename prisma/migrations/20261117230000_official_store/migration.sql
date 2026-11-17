-- AlterTable
ALTER TABLE "users" ADD COLUMN "official_store" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "shops" ADD COLUMN "is_official" BOOLEAN NOT NULL DEFAULT false;
