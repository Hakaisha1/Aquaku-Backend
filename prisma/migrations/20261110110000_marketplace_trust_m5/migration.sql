CREATE TYPE "SaleTransactionStatus" AS ENUM ('AWAITING_CONFIRMATION', 'CONFIRMED', 'REJECTED', 'CANCELLED');
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');
CREATE TYPE "ReportReason" AS ENUM ('SPAM', 'SCAM', 'PROHIBITED_ITEM', 'MISLEADING', 'HARASSMENT', 'OTHER');
CREATE TYPE "ListingModerationAction" AS ENUM ('HIDE', 'RESTORE');
CREATE TYPE "SaleTransactionCorrectionAction" AS ENUM ('BUYER_CORRECTED');

ALTER TABLE "listings"
  ADD COLUMN "moderation_hidden_at" TIMESTAMPTZ(3),
  ADD COLUMN "moderation_reason" VARCHAR(500);

CREATE TABLE "sale_transactions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "listing_id" UUID NOT NULL,
  "seller_id" UUID NOT NULL,
  "buyer_id" UUID NOT NULL,
  "status" "SaleTransactionStatus" NOT NULL DEFAULT 'AWAITING_CONFIRMATION',
  "response_note" VARCHAR(500),
  "responded_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sale_transactions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sale_transactions_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "sale_transactions_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "sale_transactions_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "sale_transactions_distinct_parties_check" CHECK ("seller_id" <> "buyer_id")
);

CREATE TABLE "ratings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sale_transaction_id" UUID NOT NULL,
  "buyer_id" UUID NOT NULL,
  "seller_id" UUID NOT NULL,
  "score" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ratings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ratings_score_check" CHECK ("score" BETWEEN 1 AND 5),
  CONSTRAINT "ratings_sale_transaction_id_fkey" FOREIGN KEY ("sale_transaction_id") REFERENCES "sale_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ratings_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ratings_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "reports" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "reporter_id" UUID NOT NULL,
  "target_listing_id" UUID,
  "target_user_id" UUID,
  "reason" "ReportReason" NOT NULL,
  "details" VARCHAR(1000),
  "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
  "reviewed_by_id" UUID,
  "review_note" VARCHAR(500),
  "reviewed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reports_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reports_exactly_one_target_check" CHECK (("target_listing_id" IS NOT NULL)::int + ("target_user_id" IS NOT NULL)::int = 1),
  CONSTRAINT "reports_reviewer_fields_check" CHECK (("status" = 'OPEN' AND "reviewed_by_id" IS NULL AND "reviewed_at" IS NULL) OR ("status" <> 'OPEN' AND "reviewed_by_id" IS NOT NULL AND "reviewed_at" IS NOT NULL)),
  CONSTRAINT "reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "reports_target_listing_id_fkey" FOREIGN KEY ("target_listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "reports_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "reports_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "moderation_actions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "listing_id" UUID NOT NULL,
  "admin_id" UUID NOT NULL,
  "action" "ListingModerationAction" NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "moderation_actions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "moderation_actions_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "moderation_actions_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "sale_transactions_listing_open_key" ON "sale_transactions"("listing_id") WHERE "status" IN ('AWAITING_CONFIRMATION', 'CONFIRMED');
CREATE INDEX "sale_transactions_listing_id_status_created_at_idx" ON "sale_transactions"("listing_id", "status", "created_at");
CREATE INDEX "sale_transactions_seller_id_status_created_at_idx" ON "sale_transactions"("seller_id", "status", "created_at");
CREATE INDEX "sale_transactions_buyer_id_status_created_at_idx" ON "sale_transactions"("buyer_id", "status", "created_at");
CREATE UNIQUE INDEX "ratings_sale_transaction_id_key" ON "ratings"("sale_transaction_id");
CREATE INDEX "ratings_seller_id_created_at_idx" ON "ratings"("seller_id", "created_at");
CREATE INDEX "reports_status_created_at_idx" ON "reports"("status", "created_at");
CREATE INDEX "reports_reporter_id_created_at_idx" ON "reports"("reporter_id", "created_at");
CREATE UNIQUE INDEX "reports_open_listing_reporter_key" ON "reports"("reporter_id", "target_listing_id") WHERE "status" = 'OPEN' AND "target_listing_id" IS NOT NULL;
CREATE UNIQUE INDEX "reports_open_user_reporter_key" ON "reports"("reporter_id", "target_user_id") WHERE "status" = 'OPEN' AND "target_user_id" IS NOT NULL;
CREATE INDEX "moderation_actions_listing_id_created_at_idx" ON "moderation_actions"("listing_id", "created_at");
CREATE INDEX "moderation_actions_admin_id_created_at_idx" ON "moderation_actions"("admin_id", "created_at");
CREATE INDEX "listings_moderation_hidden_at_idx" ON "listings"("moderation_hidden_at");

CREATE TABLE "sale_transaction_corrections" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sale_transaction_id" UUID NOT NULL,
  "admin_id" UUID NOT NULL,
  "previous_buyer_id" UUID NOT NULL,
  "new_buyer_id" UUID NOT NULL,
  "action" "SaleTransactionCorrectionAction" NOT NULL DEFAULT 'BUYER_CORRECTED',
  "reason" VARCHAR(500) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sale_transaction_corrections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sale_transaction_corrections_sale_transaction_id_fkey" FOREIGN KEY ("sale_transaction_id") REFERENCES "sale_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "sale_transaction_corrections_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "sale_transaction_corrections_previous_buyer_id_fkey" FOREIGN KEY ("previous_buyer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "sale_transaction_corrections_new_buyer_id_fkey" FOREIGN KEY ("new_buyer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "sale_transaction_corrections_sale_transaction_id_created_at_idx" ON "sale_transaction_corrections"("sale_transaction_id", "created_at");
CREATE INDEX "sale_transaction_corrections_admin_id_created_at_idx" ON "sale_transaction_corrections"("admin_id", "created_at");
