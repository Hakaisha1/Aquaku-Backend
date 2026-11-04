# Aquaku Backend

Backend untuk platform forum komunitas dan marketplace hobiis aquascape, dengan fokus awal di Semarang. Proyek ini menggabungkan diskusi, berbagi tank, dan jual-beli produk aquascape tanpa komisi transaksi.

## Status

Repositori masih pada tahap inisialisasi. Belum ada implementasi API, framework, dependensi, migrasi database, atau perintah menjalankan aplikasi. Isi berikut merupakan rencana berdasarkan dokumen konsep dan kontrak OpenAPI 3.0.3 versi 0.1.0.

## Cakupan MVP

- Registrasi, login, refresh token, verifikasi nomor HP, dan profil pengguna.
- Membership penjual Personal, Toko, dan Juragan.
- Listing dengan tag kondisi, foto, filter, kuota, masa tayang, dan cooldown.
- Pengajuan upgrade membership dan pembelian slot tambahan; aktivasi manual oleh admin.
- Forum dengan posting, kategori, foto, dan komentar.
- Rating penjual, laporan pengguna, dan moderasi admin.
- Upload foto langsung ke object storage melalui URL sementara.
- Satu fitur unggulan yang dipilih setelah validasi; kontrak API memuat contoh tank profile.

Transaksi MVP diarahkan melalui chat WhatsApp dan COD/meetup, tanpa payment gateway atau escrow.

## Rencana arsitektur

| Komponen | Tanggung jawab |
| --- | --- |
| REST API + JSON | Satu layanan backend dengan prefix `/api/v1` |
| JWT Bearer | Autentikasi; tier dan hak akses diverifikasi oleh backend |
| PostgreSQL | Akun, membership, listing, tag, kuota, cooldown, add-on, rating, laporan, dan verifikasi toko |
| MongoDB | Posting forum, komentar, tank profile, serta data fleksibel lainnya |
| Object storage | Foto/video; database hanya menyimpan URL |
| Job terjadwal | Kedaluwarsa listing dan pengingat masa tayang |

PostgreSQL menjadi sumber kebenaran untuk identitas dan tier. Dokumen MongoDB merujuk ID dari PostgreSQL. Framework, provider storage, dan provider OTP belum ditentukan. Redis bersifat opsional dan bukan kebutuhan awal.

Base URL lokal yang direncanakan: `http://localhost:3000/api/v1`.

## Aturan bisnis awal

| Tier | Listing aktif | Masa tayang | Cooldown | Barang BNIB/New |
| --- | --- | --- | --- | --- |
| Personal | 5 | 30 hari | 7 hari setelah kuota penuh, dihitung dari listing terjual/kedaluwarsa | Tidak |
| Toko | 30 | 60 hari | Tidak ada | Ya |
| Juragan | 100 | 90 hari atau tanpa batas, belum diputuskan | Tidak ada | Ya |

Nilai tersebut masih berupa asumsi dan perlu divalidasi. Slot add-on dapat menambah kuota. Backend wajib memvalidasi autentikasi dan verifikasi HP, izin tag per tier, jumlah foto, cooldown, serta kuota sebelum menyimpan listing. Kondisi Second/Like New memerlukan minimal tiga foto sesuai aturan konsep.

## Persiapan konfigurasi

1. Salin `.env.example` menjadi `.env`.
2. Sesuaikan URL PostgreSQL dan MongoDB dengan lingkungan pengembangan.
3. Isi secret access token dan refresh token dengan nilai acak yang berbeda.
4. Isi origin frontend saat tersedia. Konfigurasi provider storage dan OTP ditambahkan setelah provider dipilih.

`.env.example` adalah rancangan konfigurasi, bukan konfigurasi aplikasi yang sudah berjalan. Jangan menyimpan kredensial asli di Git. `.env` dan variasi file environment lokal diabaikan, sedangkan `.env.example` tetap dilacak.

## Isi repositori

- `.gitignore`: aturan pengecualian file lokal, rahasia, log, dan hasil build.
- `.env.example`: template konfigurasi awal tanpa secret asli.
- `README.md`: ringkasan proyek dan arah implementasi.

Dokumen referensi lokal `konsep-forum-ecommerce-aquascape (2).md` dan `openapi-aquascape.yaml` sengaja diabaikan oleh Git dan tidak disertakan dalam clone repositori.

## Langkah berikutnya

1. Tentukan bahasa, framework backend, dan dependency manager.
2. Rancang skema PostgreSQL dan dokumen MongoDB.
3. Implementasikan autentikasi, validasi konfigurasi, dan verifikasi nomor HP.
4. Implementasikan forum, listing, serta aturan tier dan kuota.
5. Tambahkan pengujian, dokumentasi API yang akan dipublikasikan, dan alur deployment.
