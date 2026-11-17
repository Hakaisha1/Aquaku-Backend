# Laporan Hasil Audit Keamanan Backend untuk Tim Frontend (audit-result.md)

**Tanggal Audit**: 17 November 2026  
**Status Keamanan Backend**: 🟢 **PRODUCTION READY** (13 Atomic Commits telah diterapkan)  
**Tujuan Dokumen**: Memberikan panduan teknis kepada Agent Frontend / Tim Frontend mengenai perubahan kontrak API, penambahan endpoint, mekanisme pembatasan laju (rate limiting), serta penyesuaian UI/UX yang diperlukan setelah audit keamanan backend.

---

## 1. Ringkasan Eksekutif untuk Frontend

Audit keamanan penuh telah selesai dilakukan pada backend Aquaku. Seluruh kerentanan **P0 (Critical Blocker)**, **P1 (High Severity)**, dan **P2 (Medium Severity)** telah diperbaiki melalui **13 atomic commit**. 

Perbaikan ini mencakup penambahan endpoint logout, penegakan pembatasan laju (Rate Limiting via Throttler), sanitasi konten Markdown forum (XSS Prevention), validasi harga add-on marketplace di backend, pengetatan tanda tangan upload Cloudinary, dan penanganan HTTP security headers.

---

## 2. Perubahan Kontrak API & Endpoint Baru

### 2.1. Endpoint Baru: `POST /api/v1/auth/logout`
Sebelumnya tidak ada mekanisme pembatalan refresh token, sehingga sesi aktif berpotensi menjadi zombie token hingga 30 hari.

- **URL**: `/api/v1/auth/logout`
- **Method**: `POST`
- **Headers**:
  ```http
  Authorization: Bearer <access_token>
  Content-Type: application/json
  ```
- **Request Body**:
  ```json
  {
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
  ```
- **Response Success (200 OK)**:
  ```json
  {
    "data": {
      "success": true
    }
  }
  ```
- **Tindakan Frontend**:
  - Saat pengguna menekan tombol **"Keluar" / "Logout"** di menu profil atau sidebar, frontend **wajib** memanggil endpoint ini terlebih dahulu.
  - Setelah response diterima (atau jika request timeout), hapus seluruh token (`access_token`, `refresh_token`, dan state user) dari local storage / secure storage, lalu arahkan pengguna ke halaman login.

---

### 2.2. Penanganan Token Family Reuse (RFC 6819)
- **Mekanisme Backend**: Jika sebuah `refreshToken` yang sudah pernah dicabut atau di-rotate dikirimkan kembali (indikasi token leakage/replay attack), backend **otomatis mencabut seluruh refresh token aktif milik user tersebut** dan mengembalikan `401 Unauthorized` dengan pesan `Refresh token reuse detected`.
- **Tindakan Frontend**:
  - Pada interceptor HTTP (misal Axios/Fetch interceptor untuk auto-refresh token): jika endpoint refresh token mengembalikan `401`, **segera batalkan semua queue request**, bersihkan storage lokal, dan redirect user ke halaman login dengan notifikasi *"Sesi Anda telah berakhir demi keamanan. Silakan login kembali."*
  - Hindari melempar request refresh token secara konkuren dari banyak tab/komponen secara bersamaan. Gunakan mekanisme locking/mutex pada refresh token interceptor agar refresh token baru tidak dianggap sebagai replay.

---

### 2.3. Moderasi Forum oleh Admin
- **Endpoint**:
  - `DELETE /api/v1/forum/posts/:postId`
  - `DELETE /api/v1/forum/posts/:postId/comments/:commentId`
- **Perubahan**: Backend telah memperbaiki hak akses admin. Sebelumnya admin mendapatkan `403 Forbidden` jika menghapus konten milik pengguna lain. Sekarang peran `admin` diizinkan penuh untuk menghapus postingan atau komentar pelanggaran.
- **Tindakan Frontend**:
  - Pada halaman detail postingan dan list komentar di forum, jika user memiliki `role === 'admin'`, frontend dapat menampilkan tombol **"Hapus (Moderator)"** baik pada postingan miliknya sendiri maupun postingan user lain.

---

## 3. Penanganan Rate Limiting (HTTP 429 Too Many Requests)

Backend kini mengaktifkan `@nestjs/throttler` global dengan limitasi ketat untuk mencegah spam, toll fraud OTP via WhatsApp, dan CPU DoS.

### Daftar Endpoint yang Dibatasi:
| Endpoint | Batasan | Dampak jika Melebihi |
|---|---|---|
| `POST /api/v1/auth/register` | 5 request / menit | HTTP 429 Too Many Requests |
| `POST /api/v1/auth/login` | 10 request / menit | HTTP 429 Too Many Requests |
| `POST /api/v1/auth/verify-phone` | 5 request / menit | HTTP 429 Too Many Requests |
| `POST /api/v1/auth/otp/resend` | 3 request / menit | HTTP 429 Too Many Requests |
| `POST /api/v1/forum/media/upload-signatures` | 10 request / menit | HTTP 429 Too Many Requests |
| `POST /api/v1/marketplace/media/upload-signatures` | 10 request / menit | HTTP 429 Too Many Requests |

### Panduan Implementasi UI/UX Frontend:
1. **Tombol "Kirim Ulang OTP"**:
   - Terapkan **countdown timer 60 detik** di tombol UI setelah user melakukan registrasi atau meminta resend OTP.
   - Nonaktifkan tombol selama hitung mundur berjalan untuk mencegah user mengklik berkali-kali.
2. **Global Error Interceptor**:
   - Tambahkan handler khusus untuk status code `429`:
     ```typescript
     if (error.response?.status === 429) {
       toast.error("Terlalu banyak permintaan dalam waktu singkat. Harap tunggu 1 menit sebelum mencoba kembali.");
     }
     ```

---

## 4. Sanitasi Konten & Pencegahan Stored XSS

### 4.1. Sanitasi di Sisi Backend
Backend telah memasang sanitizer otomatis pada:
- Judul postingan forum (`sanitizeForumTitle`)
- Isi konten postingan forum (`sanitizeForumContent`)
- Komentar postingan forum (`createComment`)

Tag HTML berbahaya seperti `<script>`, `<iframe>`, `<object>`, `<embed>`, atribut inline (`onload`, `onerror`, `onclick`), serta tautan Markdown dengan skema `javascript:...` atau `vbscript:...` akan **dibersihkan/dihapus secara otomatis**.

### 4.2. Tanggung Jawab Komponen Frontend:
- **Renderer Markdown**: Saat merender `body` postingan atau komentar di UI, pastikan parser Markdown (misal: `react-markdown`) **TIDAK** mengaktifkan `rehype-raw` tanpa sanitizer.
- **Pencegahan**: Jangan gunakan `dangerouslySetInnerHTML` secara langsung pada konten dari backend.
- Format Markdown standar seperti `**tebal**`, `*miring*`, `[tautan](https://...)`, `![gambar](https://...)`, heading, tabel, dan blockquote tetap didukung penuh.

---

## 5. Validasi Harga Add-on Marketplace di Sisi Frontend

Pada pengajuan request add-on (`POST /api/v1/marketplace/benefit-requests`):
- **Formula Harga**:
  - `kind: "SLOT_ADDON"`: Biaya adalah **Rp 10.000 per slot** (`payment_amount = slots * 10000`).
  - `kind: "COOLDOWN_BYPASS"`: Biaya adalah flat **Rp 10.000** (`payment_amount = 10000`).
- **Validasi Backend**: Backend kini memverifikasi kesesuaian `payment_amount` terhadap formula. Jika nominal yang dikirim tidak sesuai (misal: slot 5 tapi payment_amount diisi Rp 1), backend akan melempar `400 Bad Request` (`Payment amount must match addon formula: Rp ...`).
- **Tindakan Frontend**:
  - Pada form pengajuan add-on, buat field nominal pembayaran menjadi **read-only / auto-calculated** berdasarkan jumlah slot yang dipilih.
  - Tampilkan rincian kalkulasi: `Jumlah Slot × Rp 10.000 = Total Biaya`.

---

## 6. Upload Foto Cloudinary & Pemetaan Error

1. **Parameter Bertanda Tangan**:
   - Backend sekarang secara eksplisit menyertakan dan menandatangani `resource_type: "image"`.
   - Frontend yang mengunggah langsung ke Cloudinary API (`https://api.cloudinary.com/v1_1/<cloud_name>/image/upload`) harus memastikan payload form data menyertakan seluruh parameter yang dikembalikan oleh `/upload-signatures`.
2. **Pemetaan Respons `confirm-upload`**:
   - Jika foto belum selesai diunggah atau tidak ditemukan di Cloudinary, endpoint `/media/confirm-upload` kini mengembalikan **`404 Not Found`** (sebelumnya mengembalikan 503).
   - Frontend dapat menampilkan error spesifik: *"Foto gagal diunggah atau tidak ditemukan di cloud storage. Silakan pilih foto kembali."*

---

## 7. Keamanan Jaringan & HTTP Headers (Production)

1. **Helmet & Security Headers Aktif**:
   - Backend kini menyertakan header keamanan lengkap: `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `Strict-Transport-Security`, `X-Frame-Options: SAMEORIGIN`, dan menghapus `X-Powered-By`.
   - Jika frontend di-embed dalam iframe atau memanggil aset eksternal, perhatikan kebijakan CSP.
2. **Kewajiban HTTPS**:
   - Di environment production (`APP_ENV=production`), CORS hanya mengizinkan origin dengan protokol `https://`. Pastikan domain frontend production telah memakai sertifikat SSL/TLS valid.

---

## 8. Ringkasan Checklist Aksi Tim Frontend

- [ ] **Auth**: Integrasikan endpoint baru `POST /api/v1/auth/logout` pada tombol keluar pengguna.
- [ ] **Auth**: Tangani `401 Unauthorized` pada token reuse dengan membersihkan storage lokal dan mengarahkan ke halaman login.
- [ ] **Auth**: Tambahkan hitung mundur 60 detik (cooldown UI) pada tombol Kirim Ulang OTP.
- [ ] **Error Handling**: Tangani respon `HTTP 429 Too Many Requests` dengan menampilkan notifikasi user-friendly.
- [ ] **Forum**: Tampilkan tombol aksi hapus post/komentar untuk pengguna ber-role `admin`.
- [ ] **Forum**: Pastikan library rendering Markdown aman dan tidak menjalankan tag HTML raw.
- [ ] **Marketplace**: Kunci field nominal pembayaran add-on agar otomatis dihitung sesuai rumus (Rp 10.000/slot atau Rp 10.000 cooldown bypass).
- [ ] **Media**: Tangani respons `404 Not Found` pada konfirmasi upload foto.
