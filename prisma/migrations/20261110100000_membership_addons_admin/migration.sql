ALTER TABLE "listings" ALTER COLUMN "status" DROP DEFAULT;
ALTER TYPE "ListingStatus" RENAME TO "ListingStatus_old";
CREATE TYPE "ListingStatus" AS ENUM ('ACTIVE', 'SOLD', 'EXPIRED', 'INACTIVE');
ALTER TABLE "listings"
  ALTER COLUMN "status" TYPE "ListingStatus"
  USING "status"::text::"ListingStatus";
ALTER TABLE "listings" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';
DROP TYPE "ListingStatus_old";

CREATE TYPE "ListingSuspensionReason" AS ENUM ('TIER_CONDITION', 'QUOTA');
CREATE TYPE "BenefitRequestKind" AS ENUM ('MEMBERSHIP', 'SLOT_ADDON', 'COOLDOWN_BYPASS', 'SHOP_VERIFICATION');
CREATE TYPE "BenefitRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "ShopVerificationStatus" AS ENUM ('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED');

ALTER TABLE "shops"
  ADD COLUMN "verification_status" "ShopVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED';

ALTER TABLE "listings"
  ADD COLUMN "suspended_at" TIMESTAMPTZ(3),
  ADD COLUMN "suspension_reason" "ListingSuspensionReason";

CREATE TABLE "benefit_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "owner_id" UUID NOT NULL,
  "kind" "BenefitRequestKind" NOT NULL,
  "status" "BenefitRequestStatus" NOT NULL DEFAULT 'PENDING',
  "requested_tier" "Tier",
  "requested_slots" INTEGER,
  "approved_slots" INTEGER,
  "payment_amount" INTEGER,
  "proof_bytes" BYTEA,
  "proof_mime_type" VARCHAR(100),
  "shop_id" UUID,
  "reviewed_by_id" UUID,
  "review_note" VARCHAR(500),
  "reviewed_at" TIMESTAMPTZ(3),
  "entitlement_starts_at" TIMESTAMPTZ(3),
  "entitlement_expires_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "benefit_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "benefit_requests_payment_amount_positive_check" CHECK ("payment_amount" IS NULL OR "payment_amount" > 0),
  CONSTRAINT "benefit_requests_slots_positive_check" CHECK ("requested_slots" IS NULL OR "requested_slots" > 0),
  CONSTRAINT "benefit_requests_approved_slots_positive_check" CHECK ("approved_slots" IS NULL OR "approved_slots" > 0),
  CONSTRAINT "benefit_requests_proof_size_check" CHECK ("proof_bytes" IS NULL OR octet_length("proof_bytes") BETWEEN 1 AND 5242880),
  CONSTRAINT "benefit_requests_proof_pair_check" CHECK (("proof_bytes" IS NULL) = ("proof_mime_type" IS NULL)),
  CONSTRAINT "benefit_requests_payload_check" CHECK (
    ("kind" = 'MEMBERSHIP' AND "requested_tier" IN ('TOKO', 'JURAGAN') AND "requested_slots" IS NULL AND "payment_amount" IS NOT NULL AND "proof_bytes" IS NOT NULL AND "shop_id" IS NULL)
    OR ("kind" = 'SLOT_ADDON' AND "requested_tier" IS NULL AND "requested_slots" IS NOT NULL AND "payment_amount" IS NOT NULL AND "proof_bytes" IS NOT NULL AND "shop_id" IS NULL)
    OR ("kind" = 'COOLDOWN_BYPASS' AND "requested_tier" IS NULL AND "requested_slots" IS NULL AND "payment_amount" IS NOT NULL AND "proof_bytes" IS NOT NULL AND "shop_id" IS NULL)
    OR ("kind" = 'SHOP_VERIFICATION' AND "requested_tier" IS NULL AND "requested_slots" IS NULL AND "payment_amount" IS NULL AND "proof_bytes" IS NULL AND "shop_id" IS NOT NULL)
  ),
  CONSTRAINT "benefit_requests_proof_mime_check" CHECK ("proof_mime_type" IS NULL OR "proof_mime_type" IN ('image/jpeg', 'image/png', 'application/pdf')),
  CONSTRAINT "benefit_requests_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "benefit_requests_reviewer_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "benefit_requests_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "slot_addon_grants" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "request_id" UUID NOT NULL,
  "slots" INTEGER NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "ended_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "slot_addon_grants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "slot_addon_grants_slots_positive_check" CHECK ("slots" > 0),
  CONSTRAINT "slot_addon_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "slot_addon_grants_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "benefit_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "cooldown_passes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "request_id" UUID NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "consumed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cooldown_passes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cooldown_passes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "cooldown_passes_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "benefit_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "benefit_requests_owner_id_created_at_idx" ON "benefit_requests"("owner_id", "created_at");
CREATE INDEX "benefit_requests_status_kind_created_at_idx" ON "benefit_requests"("status", "kind", "created_at");
CREATE UNIQUE INDEX "benefit_requests_pending_owner_kind_key" ON "benefit_requests"("owner_id", "kind") WHERE "status" = 'PENDING';
CREATE UNIQUE INDEX "slot_addon_grants_request_id_key" ON "slot_addon_grants"("request_id");
CREATE INDEX "slot_addon_grants_user_id_expires_at_ended_at_idx" ON "slot_addon_grants"("user_id", "expires_at", "ended_at");
CREATE UNIQUE INDEX "cooldown_passes_request_id_key" ON "cooldown_passes"("request_id");
CREATE INDEX "cooldown_passes_user_id_expires_at_consumed_at_idx" ON "cooldown_passes"("user_id", "expires_at", "consumed_at");

CREATE INDEX "listings_status_suspended_at_idx" ON "listings"("status", "suspended_at");
