# Aquaku Backend

Backend untuk forum komunitas dan marketplace hobiis aquascape. Cakupan awal dibatasi oleh sistem untuk **Kota Semarang**, bukan Kabupaten Semarang. Pengguna dapat berdiskusi dan mencari barang dalam satu platform tanpa komisi transaksi barang.

## Status dan acuan

**M1 — Fondasi NestJS dan PostgreSQL sedang dikerjakan.** Scaffold NestJS beserta build, lint, unit test, dan e2e test sudah tersedia. Autentikasi dan fitur bisnis belum diimplementasikan.

- [`revision.md`](revision.md): keputusan sistem terbaru dan detail yang belum diputuskan.
- [`timeline.md`](timeline.md): milestone, checklist progres, kriteria selesai, dan aturan commit atomik.

Jika ada perbedaan dengan konsep atau draft OpenAPI lama, ikuti `revision.md`. Daftar fitur di bawah adalah rencana, bukan fitur yang sudah berjalan.

## Stack yang disepakati

| Komponen | Pilihan dan peran |
| --- | --- |
| Bahasa dan framework | TypeScript + NestJS, satu layanan backend modular |
| PostgreSQL + Prisma | Akun, membership, toko, listing, kuota, cooldown, add-on, rating, dan laporan |
| Docker | Lingkungan development, dimulai dengan PostgreSQL |
| MongoDB + Mongoose | Forum dan data fleksibel, ditambahkan setelah prioritas marketplace |
| Cloudinary | Media; database menyimpan URL dan metadata yang diperlukan |
| REST + JSON | Prefix `/api/v1` |
| JWT Bearer | Autentikasi; hak akses diperiksa oleh backend |

PostgreSQL menjadi sumber kebenaran identitas dan tier. MongoDB, Cloudinary, serta pengiriman OTP nyata tidak menjadi prasyarat M1. Base URL lokal yang direncanakan adalah `http://localhost:3000/api/v1`.

## Cakupan MVP

- Registrasi/login dengan email dan password, refresh token, serta profil pengguna.
- Satu nomor HP per akun dan maksimal satu toko per akun.
- Verifikasi HP wajib untuk memasang listing, posting, dan komentar; membaca konten publik tidak memerlukan verifikasi.
- Listing dengan tag kondisi, foto, pencarian, filter, kuota, masa tayang, dan cooldown.
- Membership Personal, Toko, dan Juragan; upgrade/add-on melalui transfer dan persetujuan admin.
- Forum dengan kategori, foto, posting, dan komentar pada tahap berikutnya.
- Konfirmasi transaksi oleh pembeli sebelum pemberian rating; laporan dan moderasi admin.
- Upload media melalui Cloudinary, dengan mekanisme upload ditentukan saat integrasi.

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

Backend memvalidasi autentikasi, verifikasi HP, wilayah, izin tag, foto, cooldown, dan kuota. Second/Like New memerlukan minimal tiga foto. Detail lifecycle yang belum final tercatat dalam `revision.md` dan gerbang keputusan `timeline.md`.

## Menjalankan scaffold

Gunakan **Node.js 24 LTS** (versi acuan `.nvmrc`: 24.22.2) dan **npm 11**. Dependency dikunci dalam `package-lock.json`. NestJS 11 dipakai agar toolchain CommonJS dan Jest tetap kompatibel.

```sh
npm ci
npm run build
npm start
```

Untuk development gunakan `npm run start:dev`. Pada checkpoint scaffold, aplikasi mendengarkan port 3000; endpoint bisnis belum tersedia.

```sh
npm run lint
npm test
npm run test:e2e
npm run test:cov
```

Override `multer` 2.5.0 menutup advisory DoS GHSA-q7qp-rjg7-q26m pada dependency transitif NestJS 11. Jangan menjalankan `npm audit fix --force` tanpa meninjau perubahan major. Temuan audit tooling development dicatat di timeline dan perlu ditinjau sebelum CI/rilis.

## Konfigurasi dan keamanan development

`.env.example` adalah template awal, belum kontrak konfigurasi aplikasi yang sudah berjalan. Nama variabel dan kebutuhan layanan akan diselaraskan pada M1. Belum ada kewajiban menjalankan MongoDB pada tahap fondasi PostgreSQL.

- Jangan commit `.env`, secret asli, token, atau data pribadi.
- Mode OTP prototipe memakai pengirim lokal tanpa biaya SMS/WhatsApp, lengkap dengan masa berlaku dan pembatasan percobaan.
- OTP lokal hanya menguji alur, bukan membuktikan kepemilikan nomor HP, dan tidak boleh aktif di production.
- Provider OTP nyata harus dipilih sebelum verifikasi dipakai oleh pengguna nyata.

## Isi repositori

- `.gitignore`: pengecualian file referensi lokal, rahasia, log, dan hasil build.
- `.env.example`: template konfigurasi awal tanpa secret asli pada commit inisialisasi.
- `README.md`: ringkasan proyek dan navigasi dokumentasi.
- `revision.md`: acuan sistem terbaru.
- `timeline.md`: rencana delivery dan pencatatan progres.

Dokumen lokal `konsep-forum-ecommerce-aquascape (2).md` dan `openapi-aquascape.yaml` tetap diabaikan Git dan tidak tersedia dalam clone. Kontrak API yang boleh dipublikasikan disiapkan saat implementasi berkembang; clone tidak boleh bergantung pada dua file lokal tersebut untuk setup.

## Aturan pengerjaan

Satu commit menyelesaikan satu tujuan logis beserta test, migrasi, dan dokumentasi yang diperlukan. Jangan mencampur fitur berbeda atau memasukkan secret. Tinjau staged diff dan jalankan validasi terkait sebelum commit; jangan mengklaim test lulus jika belum dijalankan.

Lanjutkan hanya checklist **M1 — Fondasi NestJS dan PostgreSQL** sesuai `timeline.md`. M2 dan modul bisnis belum dimulai.
