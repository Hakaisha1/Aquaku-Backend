ALTER TABLE "media_assets"
ADD COLUMN "forum_post_id" VARCHAR(24);

CREATE INDEX "media_assets_owner_id_forum_post_id_idx"
ON "media_assets"("owner_id", "forum_post_id");
