# Aquaku Backend

Backend untuk forum komunitas dan marketplace hobiis aquascape. Cakupan awal dibatasi oleh sistem untuk **Kota Semarang**, bukan Kabupaten Semarang. Pengguna dapat berdiskusi dan mencari barang dalam satu platform tanpa komisi transaksi barang.

## Status dan acuan

**M1–M6:** selesai secara lokal. Forum MongoDB/Mongoose sudah mencakup kategori, posting, foto, komentar, laporan, dan moderasi. PostgreSQL tetap menjadi sumber kebenaran akun/marketplace dan kepemilikan asset. Sebelum deploy Railway, isi `MONGODB_URI` pada environment terkait; production juga memerlukan Cloudinary dan verifikasi data wilayah Semarang.

- [`revision.md`](revision.md): keputusan sistem terbaru dan detail yang belum diputuskan.
- [`timeline.md`](timeline.md): milestone, checklist progres, kriteria selesai, dan aturan commit atomik.
- [`docs.md`](docs.md): referensi integrasi API dan checklist QA internal.
- [`front-development.md`](front-development.md): alur UI dan aturan bisnis untuk pengembangan frontend.

Jika ada perbedaan dengan konsep atau draft OpenAPI lama, ikuti `revision.md`. Fitur yang telah tersedia disebutkan di bagian status; fitur lainnya tetap berupa rencana.

## Stack yang disepakati

| Komponen | Pilihan dan peran |
| --- | --- |
| Bahasa dan framework | TypeScript + NestJS, satu layanan backend modular |
| PostgreSQL + Prisma | Akun, membership, toko, listing, kuota, cooldown, add-on, rating, laporan, dan kepemilikan asset media |
| Docker | Lingkungan development PostgreSQL dan MongoDB |
| MongoDB + Mongoose | Kategori, posting, komentar, laporan, dan moderasi forum |
| Cloudinary | Media; database menyimpan URL dan metadata yang diperlukan |
| REST + JSON | Prefix `/api/v1` |
| JWT Bearer | Autentikasi; hak akses diperiksa oleh backend |

PostgreSQL menjadi sumber kebenaran identitas, tier, dan kepemilikan foto. Dokumen MongoDB menyimpan UUID user sebagai referensi; bukan sumber kebenaran akun. Base URL lokal adalah `http://localhost:3000/api/v1`.

## Cakupan MVP

- Registrasi/login dengan email dan password, refresh token, serta profil pengguna.
- Satu nomor HP per akun dan maksimal satu toko per akun.
- Verifikasi HP wajib untuk memasang listing, posting, komentar, dan laporan; membaca konten publik tidak memerlukan verifikasi.
- Listing dengan tag kondisi, foto, pencarian, filter, kuota, masa tayang, dan cooldown.
- Membership Personal, Toko, dan Juragan; upgrade/add-on melalui transfer dan persetujuan admin.
- Forum MongoDB dengan kategori admin-managed, foto Cloudinary, posting, komentar, pagination, laporan, dan moderasi posting.
- Konfirmasi transaksi oleh pembeli sebelum pemberian rating; laporan dan moderasi admin.
- Upload foto melalui signed upload Cloudinary dengan verifikasi ukuran, format, dan kepemilikan oleh backend.

Transaksi barang diarahkan melalui WhatsApp untuk COD/meetup atau pengiriman lokal. Belum ada checkout, escrow, atau payment gateway transaksi barang. Midtrans untuk pembayaran platform dan OAuth ditunda. Tank profile hanya kandidat fitur unggulan, bukan kewajiban fondasi.

## Aturan marketplace utama

| Tier | Harga per 30 hari | Kuota dasar aktif | Masa tayang | BNIB/New |
| --- | --- | --- | --- | --- |
| Personal | Gratis | 5 | 30 hari | Tidak |
| Toko | Rp40.000 | 30 | 60 hari | Ya |
| Juragan | Rp100.000 | 100 | 90 hari | Ya |

Nilai tersebut menjadi baseline implementasi MVP, tetapi tetap perlu validasi bisnis. Periode berbayar dimulai sejak persetujuan admin, bukan awal bulan kalender.

### Kuota dan cooldown

- Kuota penuh saja belum memulai cooldown.
- Untuk Personal, listing terjual/kedaluwarsa saat kuota sebelumnya penuh memulai cooldown akun **7 hari**. Penjualan/kedaluwarsa berikutnya selama cooldown tidak mengulang hitungan.
- Penghapusan listing aktif memicu **2 hari**, meskipun kuota belum penuh. Waktu selesai cooldown tidak boleh lebih awal dari cooldown yang masih berlaku.
- Cooldown melarang pemasangan dan pengaktifan ulang listing, tetapi tidak menyembunyikan listing lain yang masih aktif.
- Toko/Juragan aktif tidak terkena cooldown Personal.
- Add-on kapasitas berlaku **30 hari sejak persetujuan admin**, dapat dipakai ulang selama berlaku, dan tidak menghapus cooldown. Add-on lewati cooldown terpisah dan tidak menambah kapasitas.
- Saat hak membership/add-on habis, listing yang tidak lagi memenuhi hak akun dinonaktifkan, bukan dihapus permanen.

Backend memvalidasi autentikasi, verifikasi HP, kelurahan Kota Semarang, tier, foto, cooldown, dan kuota. Second/Like New memerlukan minimal tiga foto; maksimal delapan foto per listing. Detail lifecycle dan daftar wilayah ada di `revision.md`.

### API marketplace dan forum

Semua endpoint memakai prefix `/api/v1`. Endpoint forum publik membaca kategori/posting/komentar; untuk membuat posting dan komentar diperlukan login serta HP terverifikasi. Daftar kategori dikelola admin. Lihat [`openapi.yaml`](openapi.yaml) untuk seluruh rute forum.

| Endpoint | Akses dan fungsi |
| --- | --- |
| `GET /marketplace/regions` | Publik; daftar kode kelurahan dan kecamatan yang diterima |
| `GET /marketplace/taxonomy` | Publik; kategori dan tag kondisi |
| `GET /marketplace/listings` | Publik; pencarian teks, kategori, kondisi, harga, lokasi, sort, pagination |
| `GET /marketplace/listings/:id` | Publik; detail listing aktif beserta tautan WhatsApp penjual jika tersedia |
| `GET /marketplace/me/listings` | Login; listing aktif, terjual, kedaluwarsa, dan nonaktif milik sendiri |
| `POST /marketplace/shops` | HP terverifikasi dan tier berbayar; membuat satu toko per akun |
| `POST /marketplace/media/upload-signatures` | HP terverifikasi; membuat parameter signed upload dan reservasi aset |
| `POST /marketplace/media/confirm-upload` | HP terverifikasi; backend memverifikasi aset Cloudinary sebelum digunakan |
| `DELETE /marketplace/media/:assetId` | Pemilik aset; menghapus file di Cloudinary secara idempoten |
| `POST /marketplace/listings` | HP terverifikasi; membuat listing dengan foto terverifikasi |
| `PATCH /marketplace/listings/:id` | Pemilik listing; mengubah listing aktif tanpa mereset masa tayang |
| `POST /marketplace/listings/:id/sold` | Pemilik listing; menandai terjual, opsional menautkan pembeli ber-HP terverifikasi, dan mengevaluasi cooldown |
| `POST /marketplace/listings/:id/sale` | Pemilik listing; menautkan/mengganti pembeli sebelum konfirmasi |
| `DELETE /marketplace/sales/:saleId` | Pemilik listing; membatalkan tautan pembeli yang masih menunggu konfirmasi |
| `GET /marketplace/me/sales` / `GET /marketplace/me/purchases` | Login; riwayat penjualan/pembelian terhubung |
| `POST /marketplace/sales/:saleId/respond` | Pembeli terhubung; konfirmasi atau tolak transaksi |
| `POST /marketplace/sales/:saleId/rating` | Pembeli terkonfirmasi; beri satu rating angka 1–5 |
| `POST /marketplace/reports` / `GET /marketplace/me/reports` | HP terverifikasi untuk membuat laporan; login untuk melihat laporan sendiri |
| `GET /marketplace/admin/reports` / `POST /marketplace/admin/reports/:id/review` | Admin; antrean dan tindak lanjut laporan |
| `GET, POST /marketplace/admin/listings/:id/moderation` | Admin; riwayat hide/restore listing dengan alasan |
| `POST /marketplace/admin/sales/:saleId/correct-buyer` / `GET /marketplace/admin/sales/:saleId/corrections` | Admin; koreksi pembeli transaksi dan lihat audit |
| `GET /users/:userId` | Publik; profil dengan ringkasan rating |
| `DELETE /marketplace/listings/:id` | Pemilik listing; soft delete dan cooldown Personal 2 hari |
| `POST /marketplace/listings/:id/renew` | Pemilik listing; memperpanjang listing Expired setelah validasi ulang |
| `POST /marketplace/listings/:id/reactivate` | Pemilik listing; aktifkan kembali listing nonaktif jika hak dan kuota mengizinkan |
| `GET /marketplace/membership/plans` | Publik; paket Toko/Juragan |
| `POST /marketplace/me/membership-requests` | HP terverifikasi; pengajuan membership dengan bukti transfer privat |
| `POST /marketplace/me/addon-requests` | HP terverifikasi; pengajuan slot/cooldown pass dengan bukti transfer privat |
| `POST /marketplace/me/shops/verification-requests` | HP terverifikasi; ajukan badge verifikasi toko |
| `GET /marketplace/me/benefit-requests` | Login; riwayat pengajuan tanpa isi bukti transfer |
| `GET /marketplace/me/entitlements` | Login; tier, add-on aktif, pass, status verifikasi toko |
| `GET /marketplace/admin/benefit-requests` | Admin; daftar pengajuan |
| `GET /marketplace/admin/benefit-requests/:id/proof` | Admin; unduh bukti transfer privat |
| `POST /marketplace/admin/benefit-requests/:id/review` | Admin; setujui/tolak secara idempoten dengan audit |
| `GET /marketplace/me/quota` | Login; informasi kuota dan cooldown akun |

Untuk upload foto listing, klien meminta signature, mengirim foto langsung ke endpoint upload Cloudinary dengan parameter yang dikembalikan, lalu memanggil `confirm-upload`. Bukti transfer membership/add-on berbeda dari foto listing: bukti JPEG/PNG/PDF maksimal 5 MB disimpan privat di PostgreSQL dan hanya dapat diunduh admin. Harga add-on belum ditetapkan; admin memeriksa nominal dan menetapkan kapasitas slot yang disetujui. Upload foto Cloudinary mengembalikan `503` sampai kredensial dan preset disiapkan.

## Menjalankan fondasi dari clone baru

Gunakan **Node.js 24 LTS** (versi acuan `.nvmrc`: 24.22.2), **npm 11**, dan Docker Desktop dengan Linux containers. Dependency dikunci dalam `package-lock.json`. NestJS 11 dipakai agar toolchain CommonJS dan Jest tetap kompatibel.

1. Jalankan `npm ci`.
2. Jalankan `docker compose up -d --wait postgres mongo`.
3. Siapkan environment proses atau file `.env` sesuai tabel konfigurasi di bawah. Gunakan port host database **5433**; jangan mengandalkan nilai template env lama.
4. Terapkan migrasi, build, lalu jalankan aplikasi:

```sh
npm run db:deploy
npm run build
npm start
```

Build otomatis menghasilkan Prisma Client; kode hasil generate tidak disimpan di Git. Untuk development gunakan `npm run start:dev`, yang juga menghasilkan client terlebih dahulu. Port HTTP default adalah 3000. Endpoint akun tersedia di `/api/v1/auth` dan `/api/v1/users`.

```sh
npm run lint
npm test
npm run test:e2e
npm run test:cov
```

Unit test tidak memerlukan database aktif; E2E menggunakan double untuk MongoDB. Integration/startup test memerlukan PostgreSQL dan MongoDB test nyata yang sehat; lihat bagian database di bawah. Integration test juga menjalankan server hasil build dalam subprocess dengan waktu tunggu terbatas, lalu menghentikannya setelah pengujian.

Override `multer` 2.5.0 menutup advisory DoS GHSA-q7qp-rjg7-q26m pada dependency transitif NestJS 11. Jangan menjalankan `npm audit fix --force` tanpa meninjau perubahan major. Temuan audit tooling development dicatat di timeline dan perlu ditinjau sebelum CI/rilis.

## PostgreSQL dan MongoDB development dengan Docker

Jalankan Docker Desktop (Linux containers), lalu:

```sh
docker compose config --quiet
docker compose up -d --wait postgres mongo
docker compose ps
docker compose exec -T postgres psql -U aquaku -d aquaku -c "SELECT 1;"
```

Compose memakai PostgreSQL 17 dan MongoDB 8 dengan health check serta named volume terpisah. Port PostgreSQL dipublikasikan hanya ke `127.0.0.1:5433`; MongoDB ke `127.0.0.1:27017`. MongoDB lokal tidak memakai autentikasi dan hanya dipublikasikan ke loopback; jangan gunakan konfigurasi ini untuk production.

URL development: `DATABASE_URL=postgresql://aquaku:aquaku_dev_password@127.0.0.1:5433/aquaku` dan `MONGODB_URI=mongodb://127.0.0.1:27017/aquaku`. Nilai ini hanya untuk development lokal. Docker Compose menjalankan database, bukan aplikasi.

```sh
docker compose stop postgres mongo
docker compose start postgres mongo
docker compose down
```

`down` mempertahankan named volume. **`docker compose down -v` menghapus data PostgreSQL dan MongoDB development**; jangan gunakan tanpa sengaja. Image dikunci ke major PostgreSQL 17 dan MongoDB 8; patch dapat berubah saat image ditarik ulang.

## Prisma dan migrasi

Prisma 7 menggunakan adapter PostgreSQL `pg` dan konfigurasi CLI `prisma.config.ts`. Generate/validasi skema tidak memerlukan koneksi database; perintah migrasi memerlukan `DATABASE_URL`.

```sh
npm run db:generate
npm run db:validate
npm run db:deploy
npm run db:status
```

`db:deploy` menerapkan migrasi yang sudah di-commit dan aman diulang. `db:migrate -- --name <nama_perubahan>` hanya untuk membuat migrasi baru dalam development; jangan gunakan reset/migrate-dev pada database production. Baseline M1 hanya menyiapkan namespace `public` dan riwayat migrasi, tanpa tabel domain/dummy. Model akun dibuat bersama fitur M2.

### Integration test PostgreSQL

Buat database test terpisah sekali saja pada volume development baru:

```sh
docker compose exec -T postgres psql -U aquaku -d postgres -c "CREATE DATABASE aquaku_test;"
```

Jika database tersebut sudah ada, tidak perlu menjalankan perintah pembuatan lagi. Terapkan migrasi pada `aquaku_test`, bukan menghapus atau mereset database utama. Contoh untuk shell POSIX/Git Bash:

```sh
DATABASE_URL=postgresql://aquaku:aquaku_dev_password@127.0.0.1:5433/aquaku_test npm run db:deploy
TEST_DATABASE_URL=postgresql://aquaku:aquaku_dev_password@127.0.0.1:5433/aquaku_test npm run test:integration
```

Pada PowerShell/CMD, set environment menggunakan sintaks shell tersebut sebelum menjalankan perintah npm. Test mewajibkan nama database berakhiran `_test`; tidak ada drop/reset otomatis. URL test tidak boleh menunjuk database production meskipun namanya berakhiran `_test`.

### Health endpoints

| Endpoint | Perilaku |
| --- | --- |
| `GET /api/v1/health/live` | `200`, `{ "data": { "status": "ok" } }`; tidak mengakses database |
| `GET /api/v1/health/ready` | `200` jika PostgreSQL dan MongoDB berhasil di-ping; `503` dengan error tersanitasi jika salah satu gagal |

Koneksi database lazy agar aplikasi tetap dapat memberikan liveness saat database mati. Readiness mem-ping PostgreSQL dan MongoDB; jika salah satu gagal, endpoint mengembalikan `503`. URL readiness tidak mengungkap host, kredensial, atau pesan error database. Jika `API_PREFIX` diubah, prefix health ikut berubah.

## Konfigurasi dan keamanan development

Aplikasi memuat `.env` saat startup tanpa menimpa environment proses yang sudah tersedia, lalu memvalidasi konfigurasi sebelum inisialisasi NestJS. Unit/e2e test tidak memuat `.env` lokal.

| Variabel | Aturan runtime |
| --- | --- |
| `APP_ENV` | `development`, `test`, atau `production`; default `development` |
| `PORT` | Integer 1–65535; default `3000` |
| `API_PREFIX` | Path tanpa trailing slash; default `/api/v1` |
| `DATABASE_URL` | Wajib, URL PostgreSQL dengan host dan nama database |
| `MONGODB_URI` | URL MongoDB; default development/test `mongodb://127.0.0.1:27017/aquaku`, wajib di production |
| `JWT_ACCESS_SECRET` | Development/test boleh kosong (secret acak per proses); production wajib minimal 32 karakter acak |
| `JWT_REFRESH_SECRET` | Aturan sama, wajib berbeda dari access secret |
| `OTP_ID_API_KEY` | Wajib di production; API key OTP.ID hanya digunakan dari backend. Jika di development/test tidak diisi, OTP lokal digunakan |
| `CORS_ORIGIN` | Opsional; satu origin HTTP/HTTPS tanpa path/kredensial/wildcard; hapus variabel untuk menonaktifkan CORS, jangan isi string kosong |
| `CLOUDINARY_URL` | Opsional; format standar `cloudinary://<api_key>:<api_secret>@<cloud_name>`, alternatif untuk tiga variabel kredensial di bawah |
| `CLOUDINARY_CLOUD_NAME` | Opsional; gunakan bersama `CLOUDINARY_API_KEY` dan `CLOUDINARY_API_SECRET` jika tidak memakai `CLOUDINARY_URL` |
| `CLOUDINARY_API_KEY` | Opsional; kunci publik Cloudinary, dibutuhkan untuk signed upload |
| `CLOUDINARY_API_SECRET` | Opsional; secret Cloudinary, tidak pernah dikirim ke klien atau log |
| `CLOUDINARY_UPLOAD_PRESET` | Opsional; wajib bersama kredensial Cloudinary; preset signed yang membatasi format JPEG/PNG/WebP dan ukuran 5 MB |

Contoh nilai development (bukan secret production):

```dotenv
APP_ENV=development
PORT=3000
API_PREFIX=/api/v1
DATABASE_URL=postgresql://aquaku:aquaku_dev_password@127.0.0.1:5433/aquaku
MONGODB_URI=mongodb://127.0.0.1:27017/aquaku
```

Konfigurasi development memakai PostgreSQL host port 5433 dan MongoDB host port 27017. Secret token development dibuat acak saat proses berjalan sehingga token tidak bertahan setelah restart. Untuk production, hasilkan dua secret berbeda dengan sumber acak yang aman dan jangan gunakan nilai contoh. Konfigurasi Cloudinary bersifat opsional dan harus lengkap: isi `CLOUDINARY_URL` atau ketiga variabel kredensial terpisah, lalu siapkan `CLOUDINARY_UPLOAD_PRESET` bertipe signed yang membatasi format dan ukuran file menjadi JPEG/PNG/WebP maksimal 5 MB. Jangan isi kedua format kredensial sekaligus. Backend tetap memeriksa format dan ukuran setelah upload; upload yang tidak sesuai akan ditolak dan diminta untuk dibersihkan dari Cloudinary.

Request menggunakan whitelist DTO dan menolak field asing. Payload JSON terlalu besar ditolak dengan `413`, encoding yang tidak didukung dengan `415`. Error HTTP memakai bentuk `{ "error": { "code": "...", "message": "..." } }`; detail exception internal tidak dikirim ke klien. Prefix, validasi, filter error, dan CORS diterapkan melalui konfigurasi aplikasi yang juga dipakai e2e test.

- Jangan commit `.env`, secret asli, token, atau data pribadi.
- OTP lokal development/test memakai kode 6 digit yang berlaku 5 menit, maksimal 5 percobaan, dan jeda kirim ulang 60 detik. Kode hanya tersedia pada response lokal dan tidak boleh dipakai untuk membuktikan nomor HP di production.
- Production memakai OTP.ID untuk mengirim WhatsApp OTP dan memverifikasi kode melalui API server-side. Set `OTP_ID_API_KEY` di environment production; kode OTP tidak disimpan atau dikirim ke klien oleh backend. Atur `brand_name` pada akun OTP.ID karena request menggunakan brand akun.
- Kirim ulang OTP tetap dibatasi cooldown lokal dan memakai `external_id` unik agar retry jaringan tidak mengirim atau menagih dua kali.
- Password menerima 12–128 karakter dan di-hash menggunakan scrypt. Access token berlaku 15 menit; refresh token berlaku 30 hari, disimpan dalam bentuk hash, dan dirotasi setiap digunakan.


## Isi repositori

- `.gitignore`: pengecualian file referensi lokal, rahasia, log, dan hasil build.
- `.env.example`: template konfigurasi awal tanpa secret asli pada commit inisialisasi.
- `README.md`: ringkasan proyek dan navigasi dokumentasi.
- `revision.md`: acuan sistem terbaru.
- `timeline.md`: rencana delivery dan pencatatan progres.
- `openapi.yaml`: kontrak REST API yang dipublikasikan.

Dokumen lokal `konsep-forum-ecommerce-aquascape (2).md` dan draft `openapi-aquascape.yaml` tetap diabaikan Git dan tidak tersedia dalam clone. Kontrak API yang dipublikasikan dan dapat dipakai dari clone ada di [`openapi.yaml`](openapi.yaml); setup tidak bergantung pada dokumen lokal tersebut.

## Aturan pengerjaan

Satu commit menyelesaikan satu tujuan logis beserta test, migrasi, dan dokumentasi yang diperlukan. Jangan mencampur fitur berbeda atau memasukkan secret. Tinjau staged diff dan jalankan validasi terkait sebelum commit; jangan mengklaim test lulus jika belum dijalankan.

Fondasi telah diverifikasi dari clone bersih: `npm ci`, migrasi/status, build, lint, 89 unit test, 63 e2e test, serta 6 integration test lulus. Audit production tidak menemukan kerentanan; audit keseluruhan masih mencatat 30 temuan tooling development (2 low, 28 moderate), bukan bukti proyek siap production.

M1–M4 selesai. Migrasi M4 sudah diterapkan pada database development dan test; build, lint, unit, E2E, serta PostgreSQL integration test lulus. Upload Cloudinary nyata tetap memerlukan kredensial serta signed preset. Lihat `timeline.md` untuk status.
