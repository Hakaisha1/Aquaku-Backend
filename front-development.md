# Panduan Pengembangan Frontend Aquaku

Panduan ini menjelaskan alur UI dan aturan bisnis marketplace agar implementasi frontend konsisten dengan backend. Berlaku untuk integrasi dan QA internal M5; bukan checklist rilis production.

## 1. Acuan dan prinsip implementasi

Urutan acuan jika ada perbedaan:

1. Response dan validasi API yang berjalan.
2. [`openapi.yaml`](openapi.yaml) untuk path, request, response, dan enum.
3. [`revision.md`](revision.md) untuk aturan bisnis lengkap.
4. [`README.md`](README.md) dan [`docs.md`](docs.md) untuk setup serta ringkasan integrasi.

Prinsip untuk UI:

- Backend adalah sumber kebenaran untuk identitas, role, verifikasi HP, tier, benefit, kuota, cooldown, masa tayang, dan perubahan status. Jangan menjadikan perhitungan frontend sebagai keputusan akhir.
- Tampilkan validasi awal agar formulir mudah digunakan, tetapi tetap tangani penolakan backend karena keadaan dapat berubah setelah data dimuat.
- Response umumnya berbentuk `{ "data": ... }`. Enum response biasanya lowercase, sedangkan enum request seperti `CONFIRM`, `REJECT`, `HIDE`, dan `RESTORE` uppercase.
- Tanggal dikirim dalam ISO 8601. Parse sebagai timestamp, simpan/olah secara konsisten, lalu tampilkan dalam zona waktu lokal.
- Nilai harga berupa integer rupiah, bukan angka pecahan.
- Jangan menganggap konfirmasi pembeli sebagai bukti pembayaran. Tidak ada checkout, escrow, atau payment gateway untuk transaksi barang.

## 2. Environment dan request API

Base URL yang tersedia:

| Environment | Base URL |
| --- | --- |
| Railway staging | `https://aquaku-backend-staging.up.railway.app/api/v1` |
| Lokal | `http://localhost:3000/api/v1` |

`openapi.yaml` memakai Railway staging sebagai server pertama/default dan lokal sebagai alternatif. Import file tersebut ke Bruno untuk mencoba endpoint dan payload.

Untuk route terlindungi, kirim:

```http
Authorization: Bearer <access_token>
Content-Type: application/json
```

Endpoint baca publik tidak memerlukan token. Upload foto ke Cloudinary dilakukan langsung dari klien dengan parameter bertanda tangan yang diperoleh dari backend; jangan pernah mengirim `CLOUDINARY_API_SECRET` ke frontend.

Staging dapat diakses publik untuk QA internal. Alur OTP menggunakan OTP.ID melalui WhatsApp outbound jika `OTP_ID_API_KEY` dikonfigurasi pada backend; pengiriman memakai kredit akun OTP.ID. Gunakan nomor milik sendiri dan data uji, jangan memakai kredensial/data pengguna nyata. API key hanya disimpan di Railway/backend, tidak pernah di frontend. Upload foto akan mengembalikan `503` sampai Cloudinary dikonfigurasi.

## 3. Akun, sesi, dan verifikasi HP

### Registrasi dan verifikasi

Alur:

1. `POST /auth/register` dengan `email`, `password`, `display_name`, dan `phone_number` dalam format yang diterima API. Backend membuat akun belum terverifikasi dan meminta OTP.
2. Jika `OTP_ID_API_KEY` dikonfigurasi, OTP.ID mengirim kode melalui WhatsApp ke nomor yang didaftarkan dan tidak mengembalikan kode dalam response API. Tanpa key di development/test, backend menggunakan OTP lokal.
3. `POST /auth/login` untuk mendapatkan `access_token`, `refresh_token`, dan profil. Login dapat dilakukan sebelum HP diverifikasi.
4. Kirim `POST /auth/verify-phone` dengan access token dari login sebagai Bearer token dan kode enam digit yang diterima lewat WhatsApp.
5. Perbarui profil lokal dari response verifikasi atau `GET /users/me`.

Password minimal 12 karakter. Resend melalui `POST /auth/otp/resend` memerlukan access token dan memiliki jeda minimal 60 detik. OTP.ID menetapkan masa berlaku dan batas percobaan pada alur provider. Untuk development/test tanpa `OTP_ID_API_KEY`, backend memakai OTP lokal; hanya pada mode lokal itu response register/resend dapat menyertakan `development_otp`. Jika API key disetel, OTP dikirim melalui OTP.ID dan kode tidak pernah disertakan di response, termasuk di development/test.

HP terverifikasi wajib untuk memasang/mengubah listing, menandai terjual, merespons transaksi, memberi rating, dan membuat laporan. Tampilkan status verifikasi serta arahkan pengguna ke alur OTP sebelum tindakan tersebut.

### Token dan profil

- Access token berlaku 15 menit; refresh token 30 hari.
- `POST /auth/refresh` melakukan rotasi refresh token. Simpan pasangan token baru secara bersama dan jangan memakai refresh token lama setelah rotasi berhasil.
- Jika request terautentikasi mendapat `401`, coba refresh satu kali bila sesi masih valid. Jika refresh gagal, hapus sesi dan minta pengguna login kembali.
- Jangan log, tampilkan, atau mengirim token ke layanan analitik.
- Profil sendiri: `GET /users/me`, perubahan profil: `PATCH /users/me`.
- Profil publik: `GET /users/{userId}`. Profil publik tidak menyertakan data kontak sensitif; menyediakan ringkasan rating dan listing aktif.
- Role pada profil hanya untuk mengatur tampilan. Backend tetap berwenang memutuskan akses admin.

## 4. Jelajah marketplace

Endpoint publik:

- `GET /marketplace/regions`: daftar kode kecamatan dan kelurahan yang valid.
- `GET /marketplace/taxonomy`: kategori dan tag kondisi yang tersedia.
- `GET /marketplace/listings`: pencarian/filter/pagination.
- `GET /marketplace/listings/{listingId}`: detail listing aktif.
- `GET /marketplace/membership/plans`: katalog benefit tier berbayar.

Gunakan nilai kategori, kondisi, dan wilayah dari API, bukan membuat daftar kode sendiri. Cakupan wilayah saat ini Kota Semarang, bukan Kabupaten Semarang; pilih kode kelurahan dari `/marketplace/regions`, jangan menerima alamat rinci bebas sebagai pengganti kode.

Filter listing mendukung `q`, `category`, `condition`, `min_price`, `max_price`, `region_code`, `district_code`, `sort`, `page`, dan `limit`. `sort` yang tersedia: `newest`, `price_asc`, `price_desc`; limit default 20 dan maksimum 50. Reset pagination saat filter berubah. Detail listing yang disembunyikan moderasi atau tidak lagi publik dapat membalas `404`; UI harus menampilkan keadaan tidak tersedia, bukan terus mencoba membuka listing.

## 5. Hak akun, tier, kuota, dan cooldown

Nilai awal tier:

| Tier | Kuota dasar aktif | Masa tayang listing | Kondisi BNIB/New |
| --- | ---: | ---: | --- |
| Personal | 5 | 30 hari | Tidak diizinkan |
| Toko | 30 | 60 hari | Diizinkan selama tier aktif |
| Juragan | 100 | 90 hari | Diizinkan selama tier aktif |

Harga saat ini juga tersedia lewat `/marketplace/membership/plans`; gunakan respons API sebagai katalog, bukan mengunci harga/hak dalam UI.

Sumber status akun dan quota:

- `GET /marketplace/me/entitlements`: tier efektif, masa berlaku, add-on, pass, dan verifikasi toko.
- `GET /marketplace/me/quota`: listing aktif, kapasitas, slot tersedia, cooldown, serta hak membuat listing.
- `GET /marketplace/me/benefit-requests`: riwayat pengajuan.

### Aturan UI yang penting

- Kuota dan cooldown adalah dua syarat terpisah. Slot tersedia tidak berarti cooldown berakhir.
- Kapasitas adalah kuota dasar ditambah slot add-on yang masih berlaku. Slot add-on dapat dipakai ulang selama masa aktif.
- Slot tambahan tidak melewati cooldown. Cooldown pass tidak menambah kuota dan harus dipilih eksplisit saat membuat listing; pass baru dikonsumsi jika listing berhasil dibuat.
- Untuk Personal, listing terjual/kedaluwarsa ketika kuota sebelum perubahan penuh dapat memulai cooldown 7 hari. Menghapus listing aktif memicu cooldown 2 hari, sekalipun kuota belum penuh.
- Penangguhan otomatis karena tier/kuota tidak memicu cooldown. Listing aktif yang lain tetap dapat dilihat dan dikelola selama masih memenuhi aturan.
- Saat membership/add-on berakhir, backend dapat menonaktifkan listing yang tidak lagi memenuhi tier atau kapasitas. Jangan menghapus listing dari UI sebagai pengganti status `inactive`.
- Gunakan waktu dan hak terkini dari API. Jangan menghitung sendiri akhir cooldown atau memperkirakan hak hanya dari data yang mungkin stale.

## 6. Membuat dan mengelola listing

### Validasi formulir

Sebelum kirim `POST /marketplace/listings`, bantu pengguna memeriksa:

- HP sudah terverifikasi.
- Kelurahan dipilih dari daftar kode wilayah API.
- Kuota tersedia dan tidak ada cooldown yang menghalangi, kecuali pass valid dipilih.
- Kondisi barang sesuai tier.
- Foto sudah selesai diupload dan diverifikasi backend.

Aturan foto:

- BNIB/New: minimal 1 foto.
- Like New/Second: minimal 3 foto.
- Maksimal 8 foto per listing, JPEG/PNG/WebP, maksimal 5 MB per foto.
- Jangan membuat listing dengan URL upload yang belum diverifikasi backend.

### Alur upload foto

1. `POST /marketplace/media/upload-signatures` untuk memperoleh `asset_id` dan parameter signed upload.
2. Upload file langsung ke Cloudinary menggunakan parameter response.
3. `POST /marketplace/media/confirm-upload` dengan `asset_id`.
4. Setelah sukses, kirim ID aset terverifikasi di `photo_ids` saat membuat/memperbarui listing.
5. Hapus foto melalui `DELETE /marketplace/media/{assetId}`. Mengubah `photo_ids` tidak menghapus foto lama secara otomatis.

### Status dan tindakan listing

| Status | Makna/tindakan UI |
| --- | --- |
| `active` | Tampil publik selama belum kedaluwarsa atau disembunyikan moderasi. Dapat diedit/dijual/dihapus sesuai hak. |
| `sold` | Terjual dan tidak dapat diaktifkan kembali. Penolakan transaksi tidak mengubah status ini. |
| `expired` | Masa tayang habis. Dapat diperpanjang melalui endpoint renew setelah validasi backend. |
| `inactive` | Dinonaktifkan sistem karena hak tier/kuota/kondisi. Dapat diaktifkan ulang hanya jika seluruh validasi backend lolos. |

Soft delete adalah pengarsipan oleh pemilik, bukan status untuk ditampilkan sebagai listing publik. Status `moderation_hidden_at`/`moderation_reason` adalah informasi moderasi yang terpisah dari status listing. Listing yang disembunyikan tidak tampil publik, tetapi tetap memakai kuota dan masa tayangnya tetap berjalan.

Endpoint pemilik:

- `GET /marketplace/me/listings`
- `POST /marketplace/listings`
- `PATCH /marketplace/listings/{listingId}`
- `DELETE /marketplace/listings/{listingId}`
- `POST /marketplace/listings/{listingId}/renew`
- `POST /marketplace/listings/{listingId}/reactivate`
- `POST /marketplace/listings/{listingId}/sold`

Jangan tampilkan tombol renew untuk listing selain `expired`, atau reactivate untuk status selain `inactive`. Tetap tangani `409`/`403` karena kuota, cooldown, tier, atau status dapat berubah sejak data terakhir dimuat.

## 7. Membership, add-on, dan toko

Pembayaran membership/add-on saat ini berupa transfer manual. Mengunggah bukti atau membuat pengajuan **tidak langsung mengaktifkan benefit**; benefit baru aktif setelah admin menyetujui.

- Paket: `GET /marketplace/membership/plans`.
- Pengajuan membership: `POST /marketplace/me/membership-requests` dengan multipart form dan bukti transfer.
- Pengajuan add-on: `POST /marketplace/me/addon-requests` dengan multipart form dan bukti.
- Riwayat: `GET /marketplace/me/benefit-requests`.
- Hak aktif: `GET /marketplace/me/entitlements`.
- Pembuatan toko memerlukan tier berbayar yang aktif. Badge verifikasi toko adalah proses terpisah dan bukan syarat tier.

Satu pengajuan Pending per akun dan jenis benefit. Setelah ditolak, pengguna dapat mengajukan ulang. Harga membership mengikuti katalog; harga add-on belum ditetapkan oleh sistem dan jumlah slot final ditentukan admin. UI harus menampilkan status `pending`, `approved`, atau `rejected` tanpa mengasumsikan transfer berarti persetujuan.

## 8. Transaksi dan rating

### Alur status transaksi

1. Penjual dapat menandai listing terjual tanpa buyer account. Response berisi `transaction: null`; rating tidak tersedia untuk penjualan itu.
2. Penjual boleh mengirim `buyer_id` saat menandai Sold, atau menautkan pembeli kemudian lewat `POST /marketplace/listings/{listingId}/sale`. Pembeli harus berbeda dari penjual dan HP-nya terverifikasi.
3. Pembeli melihat transaksi di `GET /marketplace/me/purchases`, lalu `POST /marketplace/sales/{saleId}/respond` dengan `decision: CONFIRM` atau `REJECT`.
4. Penjual dapat membatalkan transaksi yang masih `awaiting_confirmation` atau mengganti buyer sebelum konfirmasi.
5. Setelah `confirmed`, pembeli terkait dapat memberi satu rating 1–5.

| Status transaksi | Tindakan UI |
| --- | --- |
| `awaiting_confirmation` | Pembeli dapat konfirmasi/tolak; penjual dapat membatalkan atau mengganti buyer. |
| `confirmed` | Tampilkan transaksi selesai dan aksi rating jika belum ada rating. |
| `rejected` | Tampilkan penolakan; listing tetap Sold. Penjual dapat membuat tautan transaksi baru dengan buyer lain. |
| `cancelled` | Tampilkan bahwa tautan buyer dibatalkan/diganti; listing tetap Sold. |

Tidak ada timeout konfirmasi otomatis. Jangan mengubah status listing menjadi aktif akibat `REJECT`, `CANCELLED`, atau perubahan buyer.

Satu rating per transaksi. Pengiriman ulang skor sama idempoten; skor berbeda setelah rating ada menghasilkan `409`. Koreksi transaksi terkonfirmasi hanya oleh admin, wajib beralasan dan diaudit; koreksi menghapus rating lama serta meminta buyer baru mengonfirmasi ulang.

Profil publik menampilkan `rating_average` (bisa `null` jika belum ada rating), `rating_count`, dan `active_listing_count`.

## 9. Laporan dan UI admin

Pengguna terverifikasi dapat melaporkan listing atau akun melalui `POST /marketplace/reports`. Pilihan alasan: `SPAM`, `SCAM`, `PROHIBITED_ITEM`, `MISLEADING`, `HARASSMENT`, `OTHER`. Satu laporan `open` per pelapor/target; cegah duplikasi di UI, tetapi tetap tangani `409` dari backend.

Endpoint laporan:

- Riwayat sendiri: `GET /marketplace/me/reports`.
- Antrean admin: `GET /marketplace/admin/reports?status=OPEN`.
- Review admin: `POST /marketplace/admin/reports/{reportId}/review`, keputusan `RESOLVED` atau `DISMISSED`, `review_note` wajib.

Moderasi listing hanya hide/restore, bukan suspend akun:

- `GET /marketplace/admin/listings/{listingId}/moderation` untuk riwayat.
- `POST` ke path yang sama dengan `action: HIDE|RESTORE` dan alasan.
- Semua tindakan perlu alasan dan masuk audit. Listing hidden tetap memakai kuota dan masa tayang.
- Koreksi buyer transaksi: `POST /marketplace/admin/sales/{saleId}/correct-buyer` dengan `buyer_id` dan `reason`; audit dilihat melalui `GET /marketplace/admin/sales/{saleId}/corrections`.

Sembunyikan kontrol admin untuk pengguna non-admin, tetapi tetap tangani `403`. Jangan menyimpulkan laporan pengguna otomatis menangguhkan akun.

## 10. Forum

Baca `GET /forum/categories`, `GET /forum/posts?page=1&limit=20`, dan detail/komentar tanpa token. Daftar kategori dikelola admin; jika masih kosong, minta admin membuat kategori terlebih dahulu.

Untuk membuat posting atau komentar, user harus login dan HP terverifikasi. Alur posting dengan foto:

1. Minta `POST /forum/media/upload-signatures` dengan Bearer token.
2. Upload file langsung ke Cloudinary memakai parameter signature dari backend.
3. Konfirmasi `POST /forum/media/confirm-upload` dengan `{ "asset_id": "<id dari signature>" }`.
4. Kirim `POST /forum/posts` dengan `category_id`, `title`, `body`, dan opsional `photo_ids` berisi ID asset yang sudah dikonfirmasi.

Backend memeriksa kepemilikan, format, dan ukuran foto; jangan mengirim URL foto bebas. `PATCH /forum/posts/{postId}` hanya untuk penulis dan tidak mengubah foto. Penulis dapat menghapus posting/komentarnya sendiri. Laporan dan hide/restore hanya dikelola admin melalui endpoint `/forum/admin/*`; tampilkan `409` jika laporan duplikat atau status moderasi sudah berubah.

| HTTP | Perilaku yang disarankan |
| --- | --- |
| `400` | Tampilkan kesalahan input/path; pertahankan form dan beri fokus ke field bermasalah jika tersedia. |
| `401` | Access token hilang/tidak valid; coba refresh sekali, lalu minta login jika gagal. |
| `403` | Hak akses, role, kepemilikan, atau verifikasi HP tidak memenuhi syarat. Tampilkan langkah pemulihan yang sesuai; jangan retry otomatis. |
| `404` | Resource tidak ditemukan/tidak publik; arahkan kembali ke daftar atau tampilkan unavailable. |
| `409` | State/kuota/duplikasi sudah berubah; refresh detail, quota, transaksi, atau antrean sebelum aksi berikutnya. |
| `429` | Batas OTP/request tercapai; tampilkan waktu tunggu dan nonaktifkan aksi sementara. |
| `503` | Integrasi atau layanan belum tersedia, misalnya Cloudinary, OTP, MongoDB, atau PostgreSQL; tampilkan pesan sementara dan jangan terus retry. |

Untuk mutasi yang timeout atau response-nya tidak diketahui, refresh data server sebelum mengulang. Ini mencegah tindakan ganda pada listing, laporan, pembayaran manual, dan transaksi.

## 12. Checklist QA frontend

- [ ] Import `openapi.yaml` ke Bruno; server default mengarah ke Railway staging.
- [ ] Endpoint publik regions/taxonomy/listings dapat dibuka tanpa token.
- [ ] Dengan OTP.ID aktif di staging, register mengirim OTP ke WhatsApp; response tidak memuat kode. Login memberi access token, lalu verify memakai kode yang diterima dan Bearer token tersebut.
- [ ] Uji resend hanya setelah cooldown 60 detik; tangani `429` tanpa retry berulang.
- [ ] Akun belum verified mendapat arahan verifikasi pada tindakan yang mensyaratkannya.
- [ ] Kondisi barang dan minimum foto sesuai aturan; invalid region/photo ditolak backend.
- [ ] Kuota, cooldown, benefit Pending, Expired, Inactive, Sold, dan moderasi hidden ditampilkan berbeda.
- [ ] Penjualan tanpa buyer tidak menampilkan aksi konfirmasi/rating.
- [ ] Buyer yang benar dapat konfirmasi; penolakan tidak mengaktifkan listing; rating hanya setelah confirmed.
- [ ] Rating duplikat dan laporan open duplikat menangani `409` tanpa membuat data ganda.
- [ ] Role member/admin diuji; admin endpoints menolak member dengan `403`.
- [ ] Forum dapat dibaca publik dengan pagination; posting, foto, komentar, laporan, dan moderasi sesuai hak akses.
- [ ] Upload dan error Cloudinary diuji jika konfigurasi tersedia.
- [ ] Tidak ada token, OTP, bukti transfer, atau secret yang ditulis ke log/analitik.

## 13. Batasan sebelum production

Staging saat ini untuk QA internal dan memakai OTP.ID jika `OTP_ID_API_KEY` terpasang; pengujian pengiriman OTP dapat memakai kredit akun. Forum memerlukan `MONGODB_URI` di backend staging. Jangan gunakan data pengguna nyata atau membagikan OTP/token. Sebelum deploy production, isi `OTP_ID_API_KEY` dan `MONGODB_URI` pada environment Railway production secara terpisah dan tetap server-side. Rilis juga memerlukan kredensial/preset Cloudinary, verifikasi terbaru data wilayah Semarang, proteksi secret, dan tinjauan operasional/security. Lihat [`timeline.md`](timeline.md) untuk gerbang kesiapan rilis.
