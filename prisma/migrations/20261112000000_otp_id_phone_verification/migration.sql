ALTER TABLE "otp_challenges"
  ALTER COLUMN "code_hash" DROP NOT NULL,
  ADD COLUMN "provider_otp_id" VARCHAR(64),
  ADD COLUMN "external_id" VARCHAR(64),
  ADD COLUMN "provider_status" VARCHAR(16);

CREATE UNIQUE INDEX "otp_challenges_provider_otp_id_key"
  ON "otp_challenges"("provider_otp_id");
CREATE UNIQUE INDEX "otp_challenges_external_id_key"
  ON "otp_challenges"("external_id");
