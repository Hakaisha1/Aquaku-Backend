# Panduan Integrasi Frontend Marketplace

Panduan ini ditujukan untuk integrasi dan QA internal marketplace setelah M5. Ini bukan panduan rilis production. Kontrak endpoint dan model response lengkap tersedia di [`openapi.yaml`](openapi.yaml); jika ada perbedaan, kontrak OpenAPI dan aturan bisnis di [`revision.md`](revision.md) menjadi acuan.

## 1. Menjalankan dan mengakses API

Base URL development:

```text
http://localhost:3000/api/v1
```

Siapkan environment sesuai [`README.md`](README.md), jalankan PostgreSQL melalui Docker, terapkan migrasi, lalu start backend. Semua request body dan response menggunakan JSON kecuali endpoint upload/bukti yang ditentukan sebagai multipart atau binary di OpenAPI.

Untuk endpoint yang memerlukan login, kirim access token:

```http
Authorization: Bearer <access-token>
Content-Type: application/json
```

Endpoint baca marketplace publik dan `GET /users/{userId}` tidak memerlukan token. Membuat atau merespons transaksi dan membuat laporan memerlukan akun dengan nomor HP terverifikasi. Endpoint antrean, review, moderasi, dan koreksi hanya dapat digunakan admin.

Sebagian besar response dibungkus dengan properti `data`. Timestamp dikirim sebagai ISO 8601. Enum pada request umumnya uppercase, sedangkan nilai status/action yang dikembalikan API ditampilkan lowercase; ikuti schema request dan response masing-masing pada OpenAPI.

## 2. Endpoint utama untuk integrasi

| Endpoint | Akses | Kegunaan |
| --- | --- | --- |
| `GET /marketplace/regions` | Publik | Kode kelurahan/kecamatan yang diterima |
| `GET /marketplace/taxonomy` | Publik | Kategori dan tag kondisi |
| `GET /marketplace/listings` | Publik | Cari/filter listing aktif |
| `GET /marketplace/listings/{listingId}` | Publik | Detail listing aktif |
| `GET /marketplace/me/listings` | Login | Listing milik sendiri, termasuk status nonaktif/Sold |
| `POST /marketplace/listings` | Login, HP terverifikasi | Buat listing dengan foto terverifikasi |
| `PATCH /marketplace/listings/{listingId}` | Pemilik, HP terverifikasi | Ubah listing aktif |
| `POST /marketplace/listings/{listingId}/sold` | Pemilik, HP terverifikasi | Tandai terjual, opsional tautkan pembeli |
| `POST /marketplace/listings/{listingId}/sale` | Pemilik, HP terverifikasi | Tautkan atau ganti pembeli sebelum konfirmasi |
| `DELETE /marketplace/sales/{saleId}` | Penjual, HP terverifikasi | Batalkan tautan yang masih menunggu konfirmasi |
| `GET /marketplace/me/sales` | Login | Riwayat penjualan terhubung |
| `GET /marketplace/me/purchases` | Login | Riwayat pembelian terhubung |
| `POST /marketplace/sales/{saleId}/respond` | Pembeli terhubung, HP terverifikasi | Konfirmasi atau tolak transaksi |
| `POST /marketplace/sales/{saleId}/rating` | Pembeli transaksi Confirmed, HP terverifikasi | Beri rating 1–5 |
| `POST /marketplace/reports` | Login, HP terverifikasi | Laporkan listing atau pengguna |
| `GET /marketplace/me/reports` | Login | Riwayat laporan sendiri |
| `GET /marketplace/admin/reports` | Admin | Antrean laporan |
| `POST /marketplace/admin/reports/{reportId}/review` | Admin | Resolve/dismiss laporan dengan catatan |
| `GET, POST /marketplace/admin/listings/{listingId}/moderation` | Admin | Riwayat dan tindakan hide/restore listing |
| `POST /marketplace/admin/sales/{saleId}/correct-buyer` | Admin | Koreksi pembeli transaksi terkonfirmasi |
| `GET /marketplace/admin/sales/{saleId}/corrections` | Admin | Audit koreksi pembeli |
| `GET /users/{userId}` | Publik | Profil dan ringkasan rating penjual |

Prefix `/api/v1` ditambahkan pada semua path di tabel. Endpoint membership, toko, media, kuota, dan hak akun tercantum di README serta OpenAPI.

## 3. Alur transaksi dan rating

### 3.1 Tandai listing terjual

Penjual dapat mencatat penjualan tanpa menghubungkan akun pembeli:

```http
POST /api/v1/marketplace/listings/{listingId}/sold
Authorization: Bearer <access-token>
```

Body boleh tidak dikirim. Dalam kasus ini listing menjadi `sold`, `transaction` bernilai `null`, dan penjualan tidak dapat dikonfirmasi atau diberi rating di platform.

Jika pembeli mempunyai akun dengan HP terverifikasi, kirim:

```json
{
  "buyer_id": "<buyer-user-uuid>"
}
```

Response contoh:

```json
{
  "data": {
    "id": "<listing-uuid>",
    "status": "sold",
    "sold_at": "2026-11-10T12:00:00.000Z",
    "transaction": {
      "id": "<sale-uuid>",
      "buyer_id": "<buyer-user-uuid>",
      "status": "awaiting_confirmation"
    }
  }
}
```

Listing tetap `Sold` setelah penjualannya dicatat. Penolakan atau pembatalan tautan pembeli tidak mengaktifkan listing kembali.

### 3.2 Konfirmasi atau ganti pembeli

Pembeli yang ditautkan membuka riwayat di `GET /marketplace/me/purchases`, lalu merespons transaksi:

```http
POST /api/v1/marketplace/sales/{saleId}/respond
Authorization: Bearer <buyer-access-token>
Content-Type: application/json
```

```json
{
  "decision": "CONFIRM",
  "note": "Opsional, maksimal 500 karakter"
}
```

Gunakan `REJECT` bila pembeli menolak. Status transaksi menjadi `confirmed` atau `rejected`. Tidak ada konfirmasi otomatis berdasarkan timeout.

Sebelum buyer merespons, penjual dapat membatalkan transaksi menunggu melalui `DELETE /marketplace/sales/{saleId}` atau mengganti pembeli melalui:

```http
POST /api/v1/marketplace/listings/{listingId}/sale
```

```json
{
  "buyer_id": "<new-buyer-user-uuid>"
}
```

Pembeli harus berbeda dari penjual dan memiliki HP terverifikasi. Penggantian membuat transaksi menunggu konfirmasi pembeli yang baru.

Status transaksi yang digunakan UI:

- `awaiting_confirmation`: menunggu respons pembeli.
- `confirmed`: pembeli menyetujui; pembeli dapat memberi rating.
- `rejected`: pembeli menolak; listing tetap terjual. Penjual dapat menautkan pembeli lain.
- `cancelled`: penjual membatalkan atau mengganti pembeli sebelum konfirmasi.

### 3.3 Beri rating

Hanya pembeli yang terkait dengan transaksi `confirmed` yang dapat mengirim satu rating angka 1–5:

```http
POST /api/v1/marketplace/sales/{saleId}/rating
Authorization: Bearer <buyer-access-token>
Content-Type: application/json
```

```json
{
  "score": 5
}
```

Mengirim ulang skor yang sama bersifat idempoten. Mengubah rating yang sudah tercatat menghasilkan `409 Conflict`. Profil publik mengembalikan `rating_average` (null jika belum ada rating), `rating_count`, dan `active_listing_count`.

Jika pembeli perlu dikoreksi setelah transaksi Confirmed, hanya admin yang dapat melakukannya. Koreksi menghapus rating lama, mencatat alasan/audit, dan mengembalikan transaksi ke `awaiting_confirmation` untuk pembeli baru.

## 4. Laporan dan moderasi

Buat laporan untuk target listing atau pengguna:

```json
{
  "target_type": "LISTING",
  "target_id": "<listing-or-user-uuid>",
  "reason": "MISLEADING",
  "details": "Opsional, maksimal 1000 karakter"
}
```

`target_type`: `LISTING` atau `USER`. `reason`: `SPAM`, `SCAM`, `PROHIBITED_ITEM`, `MISLEADING`, `HARASSMENT`, atau `OTHER`. Satu pelapor hanya dapat memiliki satu laporan `open` untuk target yang sama; laporan baru dapat dibuat setelah laporan sebelumnya ditinjau.

Admin memeriksa `GET /marketplace/admin/reports?status=OPEN`, kemudian mengirim keputusan ke `/marketplace/admin/reports/{reportId}/review`:

```json
{
  "decision": "RESOLVED",
  "review_note": "Tindak lanjut dilakukan"
}
```

`decision` hanya `RESOLVED` atau `DISMISSED`; catatan wajib diisi. Laporan pengguna tidak otomatis menangguhkan akun.

Untuk menyembunyikan/memulihkan listing, admin mengirim ke `POST /marketplace/admin/listings/{listingId}/moderation`:

```json
{
  "action": "HIDE",
  "reason": "Menunggu pemeriksaan laporan"
}
```

Gunakan `RESTORE` untuk memulihkan listing. Listing tersembunyi tidak muncul di pencarian/detail publik, tetapi tetap menggunakan kuota dan tetap mengikuti masa tayang. Alasan dan setiap tindakan tercatat pada endpoint riwayat moderasi.

## 5. Status error yang perlu ditangani UI

- `400 Bad Request`: payload/parameter tidak valid.
- `401 Unauthorized`: access token tidak ada atau tidak valid; arahkan pengguna ke autentikasi ulang.
- `403 Forbidden`: pengguna bukan pemilik/pembeli/admin yang berhak atau HP belum terverifikasi.
- `404 Not Found`: resource tidak ditemukan atau listing tidak tersedia secara publik.
- `409 Conflict`: transisi status tidak diizinkan, transaksi/laporan duplikat, atau rating tidak dapat diubah.

Jangan mengasumsikan semua error dapat dicoba ulang. Untuk `409`, refresh detail/riwayat terlebih dahulu dan tampilkan status terbaru. Bentuk response error mengikuti format error API yang digunakan backend.

## 6. Checklist QA integrasi

1. Pengunjung tanpa login dapat mencari listing aktif dan membuka profil publik.
2. Akun tanpa HP terverifikasi ditolak saat melakukan tindakan yang mewajibkan verifikasi.
3. Penjual menandai listing terjual tanpa pembeli; response memiliki `transaction: null`.
4. Penjual menandai terjual dengan pembeli verified; pembeli yang salah ditolak, pembeli benar dapat konfirmasi.
5. Rating sebelum konfirmasi atau dari akun lain ditolak; rating 1–5 setelah konfirmasi diterima dan hanya satu per transaksi.
6. Pembeli menolak transaksi; listing tetap Sold dan penjual dapat menghubungkan pembeli baru.
7. Admin mengoreksi pembeli; rating lama hilang, alasan tersimpan, dan pembeli baru perlu konfirmasi ulang.
8. Pengguna membuat laporan listing/pengguna, melihat laporan sendiri, dan tidak dapat mengirim laporan Open duplikat pada target yang sama.
9. Non-admin tidak dapat membuka antrean atau endpoint moderasi admin.
10. Admin hide/restore listing; listing hidden tidak dapat dibuka publik, tetap ada di kuota, dan riwayat tindakan menampilkan alasan.

## 7. Batasan untuk QA dan rilis

- Konfirmasi pembeli dan rating bukan bukti pembayaran independen. Checkout, escrow, dan payment gateway transaksi barang tidak tersedia.
- OTP yang tersedia untuk development bukan provider OTP produksi.
- Upload foto listing memerlukan kredensial dan preset Cloudinary yang valid; tanpa konfigurasi tersebut upload mengembalikan `503`.
- Kode wilayah ditujukan untuk Kota Semarang; verifikasi akhir data wilayah tetap diperlukan sebelum production.
- Panduan ini dan milestone M5 menyiapkan integrasi marketplace internal. Keamanan, operasional, CI/deployment, backup, dan uji rilis publik tetap bagian pekerjaan kesiapan rilis berikutnya.
