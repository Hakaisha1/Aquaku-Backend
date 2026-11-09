CREATE TYPE "ListingStatus" AS ENUM ('ACTIVE', 'SOLD', 'EXPIRED');
CREATE TYPE "ListingCondition" AS ENUM ('BNIB', 'NEW', 'LIKE_NEW', 'SECOND');

ALTER TABLE "users" ADD COLUMN "personal_cooldown_until" TIMESTAMPTZ(3);

CREATE TABLE "regions" (
    "code" VARCHAR(32) NOT NULL,
    "district_code" VARCHAR(16) NOT NULL,
    "district_name" VARCHAR(100) NOT NULL,
    "village_name" VARCHAR(100) NOT NULL,
    CONSTRAINT "regions_pkey" PRIMARY KEY ("code")
);

CREATE TABLE "categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" VARCHAR(64) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "listing_tags" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" VARCHAR(64) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "minimum_tier" "Tier" NOT NULL DEFAULT 'PERSONAL',
    CONSTRAINT "listing_tags_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "shops" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "shops_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "listings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "seller_id" UUID NOT NULL,
    "shop_id" UUID,
    "category_id" UUID NOT NULL,
    "region_code" VARCHAR(32) NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "description" VARCHAR(5000) NOT NULL,
    "price" INTEGER NOT NULL,
    "condition" "ListingCondition" NOT NULL,
    "status" "ListingStatus" NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "sold_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "listings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "listings_price_positive_check" CHECK ("price" > 0)
);

CREATE TABLE "listing_tag_assignments" (
    "listing_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,
    CONSTRAINT "listing_tag_assignments_pkey" PRIMARY KEY ("listing_id", "tag_id")
);

CREATE TABLE "media_assets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" UUID NOT NULL,
    "listing_id" UUID,
    "public_id" VARCHAR(255) NOT NULL,
    "secure_url" VARCHAR(2048),
    "format" VARCHAR(8),
    "bytes" INTEGER,
    "signed_at" TIMESTAMPTZ(3) NOT NULL,
    "uploaded_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "media_assets_bytes_positive_check" CHECK ("bytes" IS NULL OR "bytes" > 0)
);

CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");
CREATE UNIQUE INDEX "listing_tags_slug_key" ON "listing_tags"("slug");
CREATE UNIQUE INDEX "shops_owner_id_key" ON "shops"("owner_id");
CREATE UNIQUE INDEX "media_assets_public_id_key" ON "media_assets"("public_id");
CREATE INDEX "regions_district_code_village_name_idx" ON "regions"("district_code", "village_name");
CREATE INDEX "listings_status_deleted_at_expires_at_idx" ON "listings"("status", "deleted_at", "expires_at");
CREATE INDEX "listings_seller_id_status_deleted_at_idx" ON "listings"("seller_id", "status", "deleted_at");
CREATE INDEX "listings_category_id_status_deleted_at_idx" ON "listings"("category_id", "status", "deleted_at");
CREATE INDEX "listings_region_code_status_deleted_at_idx" ON "listings"("region_code", "status", "deleted_at");
CREATE INDEX "listings_price_status_deleted_at_idx" ON "listings"("price", "status", "deleted_at");
CREATE INDEX "listing_tag_assignments_tag_id_listing_id_idx" ON "listing_tag_assignments"("tag_id", "listing_id");
CREATE INDEX "media_assets_owner_id_listing_id_idx" ON "media_assets"("owner_id", "listing_id");
CREATE INDEX "media_assets_signed_at_idx" ON "media_assets"("signed_at");

ALTER TABLE "shops" ADD CONSTRAINT "shops_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "listings" ADD CONSTRAINT "listings_seller_id_fkey"
  FOREIGN KEY ("seller_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "listings" ADD CONSTRAINT "listings_shop_id_fkey"
  FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "listings" ADD CONSTRAINT "listings_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "listings" ADD CONSTRAINT "listings_region_code_fkey"
  FOREIGN KEY ("region_code") REFERENCES "regions"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "listing_tag_assignments" ADD CONSTRAINT "listing_tag_assignments_listing_id_fkey"
  FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "listing_tag_assignments" ADD CONSTRAINT "listing_tag_assignments_tag_id_fkey"
  FOREIGN KEY ("tag_id") REFERENCES "listing_tags"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_listing_id_fkey"
  FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "categories" ("slug", "name") VALUES
  ('aquatic-plants', 'Tanaman air'),
  ('aquatic-animals', 'Hewan air'),
  ('equipment', 'Peralatan'),
  ('hardscape', 'Hardscape'),
  ('aquarium', 'Akuarium'),
  ('other', 'Lainnya');

INSERT INTO "listing_tags" ("slug", "name", "minimum_tier") VALUES
  ('bnib', 'BNIB', 'TOKO'),
  ('new', 'Baru', 'TOKO'),
  ('like-new', 'Like New', 'PERSONAL'),
  ('second', 'Second', 'PERSONAL');

-- Snapshot from the Semarang City kelurahan directory. `code` is a stable
-- application key; district_code is the Kemendagri district code.
INSERT INTO "regions" ("code", "district_code", "district_name", "village_name") VALUES
  ('337411-banyumanik', '337411', 'Banyumanik', 'Banyumanik'),
  ('337411-gedawang', '337411', 'Banyumanik', 'Gedawang'),
  ('337411-jabungan', '337411', 'Banyumanik', 'Jabungan'),
  ('337411-ngesrep', '337411', 'Banyumanik', 'Ngesrep'),
  ('337411-padangsari', '337411', 'Banyumanik', 'Padangsari'),
  ('337411-pedalangan', '337411', 'Banyumanik', 'Pedalangan'),
  ('337411-pudakpayung', '337411', 'Banyumanik', 'Pudakpayung'),
  ('337411-srondol-kulon', '337411', 'Banyumanik', 'Srondol Kulon'),
  ('337411-srondol-wetan', '337411', 'Banyumanik', 'Srondol Wetan'),
  ('337411-sumurboto', '337411', 'Banyumanik', 'Sumurboto'),
  ('337411-tinjomoyo', '337411', 'Banyumanik', 'Tinjomoyo'),
  ('337408-candi', '337408', 'Candisari', 'Candi'),
  ('337408-jatingaleh', '337408', 'Candisari', 'Jatingaleh'),
  ('337408-jomblang', '337408', 'Candisari', 'Jomblang'),
  ('337408-kaliwiru', '337408', 'Candisari', 'Kaliwiru'),
  ('337408-karanganyar-gunung', '337408', 'Candisari', 'Karanganyar Gunung'),
  ('337408-tegalsari', '337408', 'Candisari', 'Tegalsari'),
  ('337408-wonotingal', '337408', 'Candisari', 'Wonotingal'),
  ('337409-bendanduwur', '337409', 'Gajahmungkur', 'Bendanduwur'),
  ('337409-bendan-ngisor', '337409', 'Gajahmungkur', 'Bendan Ngisor'),
  ('337409-bendungan', '337409', 'Gajahmungkur', 'Bendungan'),
  ('337409-gajahmungkur', '337409', 'Gajahmungkur', 'Gajahmungkur'),
  ('337409-karangrejo', '337409', 'Gajahmungkur', 'Karangrejo'),
  ('337409-lempongsari', '337409', 'Gajahmungkur', 'Lempongsari'),
  ('337409-petompon', '337409', 'Gajahmungkur', 'Petompon'),
  ('337409-sampangan', '337409', 'Gajahmungkur', 'Sampangan'),
  ('337404-gayamsari', '337404', 'Gayamsari', 'Gayamsari'),
  ('337404-kaligawe', '337404', 'Gayamsari', 'Kaligawe'),
  ('337404-pandean-lamper', '337404', 'Gayamsari', 'Pandean Lamper'),
  ('337404-sambirejo', '337404', 'Gayamsari', 'Sambirejo'),
  ('337404-sawah-besar', '337404', 'Gayamsari', 'Sawahbesar'),
  ('337404-siwalan', '337404', 'Gayamsari', 'Siwalan'),
  ('337404-tambakrejo', '337404', 'Gayamsari', 'Tambakrejo'),
  ('337405-bangetayu-kulon', '337405', 'Genuk', 'Bangetayu Kulon'),
  ('337405-bangetayu-wetan', '337405', 'Genuk', 'Bangetayu Wetan'),
  ('337405-banjardowo', '337405', 'Genuk', 'Banjardowo'),
  ('337405-gebangsari', '337405', 'Genuk', 'Gebangsari'),
  ('337405-genuksari', '337405', 'Genuk', 'Genuksari'),
  ('337405-karangroto', '337405', 'Genuk', 'Karangroto'),
  ('337405-kudu', '337405', 'Genuk', 'Kudu'),
  ('337405-muktiharjo-lor', '337405', 'Genuk', 'Muktiharjo Lor'),
  ('337405-penggaron-lor', '337405', 'Genuk', 'Penggaron Lor'),
  ('337405-sembungharjo', '337405', 'Genuk', 'Sembungharjo'),
  ('337405-terboyo-kulon', '337405', 'Genuk', 'Terboyo Kulon'),
  ('337405-terboyo-wetan', '337405', 'Genuk', 'Terboyo Wetan'),
  ('337405-trimulyo', '337405', 'Genuk', 'Trimulyo'),
  ('337412-cepoko', '337412', 'Gunungpati', 'Cepoko'),
  ('337412-gunungpati', '337412', 'Gunungpati', 'Gunungpati'),
  ('337412-jatirejo', '337412', 'Gunungpati', 'Jatirejo'),
  ('337412-kalisegoro', '337412', 'Gunungpati', 'Kalisegoro'),
  ('337412-kandri', '337412', 'Gunungpati', 'Kandri'),
  ('337412-mangunsari', '337412', 'Gunungpati', 'Mangunsari'),
  ('337412-ngijo', '337412', 'Gunungpati', 'Ngijo'),
  ('337412-nongkosawit', '337412', 'Gunungpati', 'Nongkosawit'),
  ('337412-pakintelan', '337412', 'Gunungpati', 'Pakintelan'),
  ('337412-patemon', '337412', 'Gunungpati', 'Patemon'),
  ('337412-plalangan', '337412', 'Gunungpati', 'Plalangan'),
  ('337412-pongangan', '337412', 'Gunungpati', 'Pongangan'),
  ('337412-sadeng', '337412', 'Gunungpati', 'Sadeng'),
  ('337412-sekaran', '337412', 'Gunungpati', 'Sekaran'),
  ('337412-sukorejo', '337412', 'Gunungpati', 'Sukorejo'),
  ('337412-sumurrejo', '337412', 'Gunungpati', 'Sumurrejo'),
  ('337414-bubakan', '337414', 'Mijen', 'Bubakan'),
  ('337414-cangkiran', '337414', 'Mijen', 'Cangkiran'),
  ('337414-jatibarang', '337414', 'Mijen', 'Jatibarang'),
  ('337414-jatisari', '337414', 'Mijen', 'Jatisari'),
  ('337414-karangmalang', '337414', 'Mijen', 'Karangmalang'),
  ('337414-kedungpane', '337414', 'Mijen', 'Kedungpane'),
  ('337414-mijen', '337414', 'Mijen', 'Mijen'),
  ('337414-ngadirgo', '337414', 'Mijen', 'Ngadirgo'),
  ('337414-pesantren', '337414', 'Mijen', 'Pesantren'),
  ('337414-polaman', '337414', 'Mijen', 'Polaman'),
  ('337414-purwosari', '337414', 'Mijen', 'Purwosari'),
  ('337414-rejosari', '337414', 'Mijen', 'Rejosari'),
  ('337414-tambangan', '337414', 'Mijen', 'Tambangan'),
  ('337414-wonolopo', '337414', 'Mijen', 'Wonolopo'),
  ('337414-wonoplumbon', '337414', 'Mijen', 'Wonoplumbon'),
  ('337415-bambankerep', '337415', 'Ngaliyan', 'Bambankerep'),
  ('337415-bringin', '337415', 'Ngaliyan', 'Bringin'),
  ('337415-gondoriyo', '337415', 'Ngaliyan', 'Gondoriyo'),
  ('337415-kalipancur', '337415', 'Ngaliyan', 'Kalipancur'),
  ('337415-ngaliyan', '337415', 'Ngaliyan', 'Ngaliyan'),
  ('337415-podorejo', '337415', 'Ngaliyan', 'Podorejo'),
  ('337415-purwoyoso', '337415', 'Ngaliyan', 'Purwoyoso'),
  ('337415-tambakaji', '337415', 'Ngaliyan', 'Tambakaji'),
  ('337415-wates', '337415', 'Ngaliyan', 'Wates'),
  ('337415-wonosari', '337415', 'Ngaliyan', 'Wonosari'),
  ('337406-gemah', '337406', 'Pedurungan', 'Gemah'),
  ('337406-kalicar', '337406', 'Pedurungan', 'Kalicari'),
  ('337406-palebon', '337406', 'Pedurungan', 'Palebon'),
  ('337406-pedurungan-kidul', '337406', 'Pedurungan', 'Pedurungan Kidul'),
  ('337406-pedurungan-lor', '337406', 'Pedurungan', 'Pedurungan Lor'),
  ('337406-pedurungan-tengah', '337406', 'Pedurungan', 'Pedurungan Tengah'),
  ('337406-penggaron-kidul', '337406', 'Pedurungan', 'Penggaron Kidul'),
  ('337406-plamongansari', '337406', 'Pedurungan', 'Plamongansari'),
  ('337406-tlogomulyo', '337406', 'Pedurungan', 'Tlogomulyo'),
  ('337406-tlogosari-kulon', '337406', 'Pedurungan', 'Tlogosari Kulon'),
  ('337406-tlogosari-wetan', '337406', 'Pedurungan', 'Tlogosari Wetan'),
  ('337406-penggaron', '337406', 'Pedurungan', 'Penggaron'),
  ('337407-barusari', '337407', 'Semarang Selatan', 'Barusari'),
  ('337407-bulustalan', '337407', 'Semarang Selatan', 'Bulustalan'),
  ('337407-lamper-kidul', '337407', 'Semarang Selatan', 'Lamper Kidul'),
  ('337407-lamper-lor', '337407', 'Semarang Selatan', 'Lamper Lor'),
  ('337407-lamper-tengah', '337407', 'Semarang Selatan', 'Lamper Tengah'),
  ('337407-mugassari', '337407', 'Semarang Selatan', 'Mugassari'),
  ('337407-peterongan', '337407', 'Semarang Selatan', 'Peterongan'),
  ('337407-pleburan', '337407', 'Semarang Selatan', 'Pleburan'),
  ('337407-randusari', '337407', 'Semarang Selatan', 'Randusari'),
  ('337407-wonodri', '337407', 'Semarang Selatan', 'Wonodri'),
  ('337407-sarirejo', '337407', 'Semarang Selatan', 'Sarirejo'),
  ('337403-bugangan', '337403', 'Semarang Timur', 'Bugangan'),
  ('337403-karangtempel', '337403', 'Semarang Timur', 'Karangtempel'),
  ('337403-karangturi', '337403', 'Semarang Timur', 'Karangturi'),
  ('337403-kebonagung', '337403', 'Semarang Timur', 'Kebonagung'),
  ('337403-kemijen', '337403', 'Semarang Timur', 'Kemijen'),
  ('337403-mlatibaru', '337403', 'Semarang Timur', 'Mlatibaru'),
  ('337403-mlatihardjo', '337403', 'Semarang Timur', 'Mlatiharjo'),
  ('337403-rejomulyo', '337403', 'Semarang Timur', 'Rejomulyo'),
  ('337403-karangtempel-barat', '337403', 'Semarang Timur', 'Karangtempel Barat'),
  ('337410-bulusan', '337410', 'Tembalang', 'Bulusan'),
  ('337410-jangli', '337410', 'Tembalang', 'Jangli'),
  ('337410-kedungmundu', '337410', 'Tembalang', 'Kedungmundu'),
  ('337410-kramas', '337410', 'Tembalang', 'Kramas'),
  ('337410-mangunharjo', '337410', 'Tembalang', 'Mangunharjo'),
  ('337410-meteseh', '337410', 'Tembalang', 'Meteseh'),
  ('337410-rowosari', '337410', 'Tembalang', 'Rowosari'),
  ('337410-sambiroto', '337410', 'Tembalang', 'Sambiroto'),
  ('337410-sendangguwo', '337410', 'Tembalang', 'Sendangguwo'),
  ('337410-sendangmulyo', '337410', 'Tembalang', 'Sendangmulyo'),
  ('337410-tandang', '337410', 'Tembalang', 'Tandang'),
  ('337410-tembalang', '337410', 'Tembalang', 'Tembalang'),
  ('337413-bojongsalaman', '337413', 'Semarang Barat', 'Bojongsalaman'),
  ('337413-bongsari', '337413', 'Semarang Barat', 'Bongsari'),
  ('337413-cabean', '337413', 'Semarang Barat', 'Cabean'),
  ('337413-gisikdrono', '337413', 'Semarang Barat', 'Gisikdrono'),
  ('337413-kalibanteng-kidul', '337413', 'Semarang Barat', 'Kalibanteng Kidul'),
  ('337413-kalibanteng-kulon', '337413', 'Semarang Barat', 'Kalibanteng Kulon'),
  ('337413-karangayu', '337413', 'Semarang Barat', 'Karangayu'),
  ('337413-kembangarum', '337413', 'Semarang Barat', 'Kembangarum'),
  ('337413-krapyak', '337413', 'Semarang Barat', 'Krapyak'),
  ('337413-krobokan', '337413', 'Semarang Barat', 'Krobokan'),
  ('337413-manyaran', '337413', 'Semarang Barat', 'Manyaran'),
  ('337413-ngemplak-simongan', '337413', 'Semarang Barat', 'Ngemplak Simongan'),
  ('337413-salaman-mloyo', '337413', 'Semarang Barat', 'Salaman Mloyo'),
  ('337413-tambaharjo', '337413', 'Semarang Barat', 'Tambakharjo'),
  ('337413-tawangsari', '337413', 'Semarang Barat', 'Tawangsari'),
  ('337413-tawangmas', '337413', 'Semarang Barat', 'Tawangmas'),
  ('337401-bangunharjo', '337401', 'Semarang Tengah', 'Bangunharjo'),
  ('337401-brumbungan', '337401', 'Semarang Tengah', 'Brumbungan'),
  ('337401-gabahan', '337401', 'Semarang Tengah', 'Gabahan'),
  ('337401-jagalan', '337401', 'Semarang Tengah', 'Jagalan'),
  ('337401-karangkidul', '337401', 'Semarang Tengah', 'Karangkidul'),
  ('337401-kauman', '337401', 'Semarang Tengah', 'Kauman'),
  ('337401-kembangsari', '337401', 'Semarang Tengah', 'Kembangsari'),
  ('337401-pekunden', '337401', 'Semarang Tengah', 'Pekunden'),
  ('337401-pendrikankidul', '337401', 'Semarang Tengah', 'Pekunden'),
  ('337401-pendrikan-kidul', '337401', 'Semarang Tengah', 'Pendrikan Kidul'),
  ('337401-pendrikan-lor', '337401', 'Semarang Tengah', 'Pendrikan Lor'),
  ('337401-pandansari', '337401', 'Semarang Tengah', 'Pandansari'),
  ('337401-miroto', '337401', 'Semarang Tengah', 'Miroto'),
  ('337401-purwodinatan', '337401', 'Semarang Tengah', 'Purwodinatan'),
  ('337401-sekayu', '337401', 'Semarang Tengah', 'Sekayu'),
  ('337402-bululor', '337402', 'Semarang Utara', 'Bulu Lor'),
  ('337402-dadapsari', '337402', 'Semarang Utara', 'Dadapsari'),
  ('337402-panggung-kidul', '337402', 'Semarang Utara', 'Panggung Kidul'),
  ('337402-panggung-lor', '337402', 'Semarang Utara', 'Panggung Lor'),
  ('337402-plombokan', '337402', 'Semarang Utara', 'Plombokan'),
  ('337402-purwosari', '337402', 'Semarang Utara', 'Purwosari'),
  ('337402-tanjung-mas', '337402', 'Semarang Utara', 'Tanjung Mas'),
  ('337402-bandarharjo', '337402', 'Semarang Utara', 'Bandarharjo'),
  ('337402-kuningan', '337402', 'Semarang Utara', 'Kuningan'),
  ('337416-jerakah', '337416', 'Tugu', 'Jerakah'),
  ('337416-karanganyar', '337416', 'Tugu', 'Karanganyar'),
  ('337416-mangkang-kulon', '337416', 'Tugu', 'Mangkang Kulon'),
  ('337416-mangkang-wetan', '337416', 'Tugu', 'Mangkang Wetan'),
  ('337416-mangunharjo', '337416', 'Tugu', 'Mangunharjo'),
  ('337416-randugarut', '337416', 'Tugu', 'Randugarut'),
  ('337416-tugurejo', '337416', 'Tugu', 'Tugurejo');
