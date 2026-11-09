# Timeline dan Progres Pengembangan Aquaku Backend

## 1. Tujuan dan acuan

Dokumen ini mengatur urutan pengerjaan, pencatatan progres, kriteria selesai, dan aturan commit atomik.

- **Aturan sistem:** ikuti `revision.md`.
- **Urutan dan progres pekerjaan:** ikuti `timeline.md` ini.
- Jika keduanya bertentangan, aturan bisnis dalam `revision.md` menjadi acuan; selaraskan dokumen sebelum implementasi terkait.
- Timeline menggunakan milestone berurutan, bukan tanggal atau estimasi durasi yang belum disepakati.
- Pekerjaan yang masih berupa rencana tidak boleh ditandai selesai.

## 2. Ringkasan milestone

| ID | Milestone | Dependensi | Status |
| --- | --- | --- | --- |
| M0 | Inisialisasi dan acuan proyek | Tidak ada | Selesai |
| M1 | Fondasi NestJS dan PostgreSQL | M0 | Selesai |
| M2 | Akun, autentikasi, dan OTP development | M1 | Selesai |
| M3 | Marketplace dan aturan listing | M2; keputusan wilayah dan lifecycle listing | Belum dimulai |
| M4 | Membership, add-on, dan admin | M3; keputusan lifecycle hak berbayar | Belum dimulai |
| M5 | Konfirmasi transaksi dan kepercayaan | M3; keputusan konfirmasi transaksi | Belum dimulai |
| M6 | Forum dan MongoDB | M4 dan M5 sebagai prioritas delivery | Belum dimulai |
| M7 | Kesiapan uji pengguna dan rilis | M4–M6 untuk MVP forum + marketplace | Belum dimulai |

**Posisi saat ini:** M0, M1, dan M2 selesai. `.env.example` telah diselaraskan ke PostgreSQL development port 5433 dan menghapus variabel MongoDB yang belum dipakai. Migrasi akun sudah diterapkan pada database development dan database test; unit, e2e, dan integration test lulus. Perubahan sesi ini belum di-commit atau di-push.

## 3. Checklist dan kriteria selesai

### M0 — Inisialisasi dan acuan proyek

- [x] Inisialisasi Git dan konfigurasi remote GitHub.
- [x] Buat `.gitignore`, `README.md`, dan template `.env.example` pada commit awal.
- [x] Abaikan dua dokumen referensi lokal asli tanpa mengabaikan seluruh file Markdown/YAML.
- [x] Buat `revision.md` sebagai acuan sistem terbaru.
- [x] Buat `timeline.md` sebagai acuan pengerjaan dan commit.
- [x] Tinjau dan selaraskan dokumentasi awal dengan keputusan terbaru sebelum scaffold.
- [x] Commit dokumen perencanaan setelah ada instruksi commit; disertakan dalam commit checkpoint yang memuat pembaruan ini.

**Selesai jika:** acuan konsisten, dokumen perencanaan tercatat di Git, dan status implementasi tidak dilebih-lebihkan. Commit awal yang sudah dibuat: `edeca25`.

**Catatan penutupan M0:** README sudah diselaraskan dengan `revision.md`; `revision.md` dan `timeline.md` tidak lagi diabaikan Git. Dua dokumen referensi lokal asli tetap diabaikan. `.env.example` tidak diubah karena dilindungi pengaturan `private_files` editor; penyesuaian konfigurasi aplikasi tetap merupakan pekerjaan M1 dan memerlukan akses yang diizinkan. Tidak ada scaffold, instalasi dependency, atau test aplikasi pada M0.

### M1 — Fondasi NestJS dan PostgreSQL

- [x] Tentukan versi toolchain yang kompatibel dan satu dependency manager; simpan lockfile.
- [x] Scaffold NestJS + TypeScript tanpa menimpa dokumen atau pekerjaan yang sudah ada.
- [x] Siapkan perintah build, lint, unit test, dan e2e test.
- [x] Siapkan Docker Compose PostgreSQL, volume data, dan health check database.
- [x] Integrasikan Prisma dan mekanisme migrasi yang dapat dijalankan ulang dari database kosong.
- [x] Validasi environment saat startup.
- [x] Sesuaikan `.env.example` tanpa secret asli; URL PostgreSQL mengarah ke `127.0.0.1:5433`, variabel MongoDB yang belum dipakai dihapus, dan secret JWT tetap berupa placeholder kosong untuk development.
- [x] Terapkan prefix `/api/v1`, validasi request, dan format error konsisten.
- [x] Tambahkan health/readiness check yang membedakan aplikasi hidup dari database siap.
- [x] Dokumentasikan setup dari clone baru dan jalankan pengujian fondasi.

**Selesai jika:** aplikasi dapat dibangun dan dijalankan mengikuti README; konfigurasi tidak valid ditolak; readiness mendeteksi kegagalan database; pengujian terkait lulus. MongoDB, Cloudinary, OTP nyata, dan Midtrans tidak menjadi dependensi tahap ini.

**Penutupan M1:** template env telah diselaraskan dengan kontrak README dan Compose. Diff Git mengonfirmasi pembaruan URL serta penghapusan konfigurasi MongoDB; akses baca penuh tetap dibatasi `private_files`. Test/build/lint fondasi lulus pada validasi sesi ini. M1 selesai. Docker tidak aktif pada percobaan awal M2, lalu berhasil dijalankan untuk menerapkan migrasi tanpa reset/drop.

### M2 — Akun, autentikasi, dan OTP development

- [x] Finalkan kebijakan password/token serta masa berlaku dan batas percobaan OTP di `revision.md`.
- [x] Buat skema dan migrasi akun, normalisasi nomor HP, serta constraint email/nomor HP unik.
- [x] Implementasikan registrasi dengan tier awal Personal dan password yang di-hash.
- [x] Implementasikan login, access token, refresh token, dan penanganan refresh token tidak valid/kedaluwarsa.
- [x] Implementasikan profil sendiri/publik dengan pembatasan data sensitif.
- [x] Implementasikan pengirim OTP development dan pengirim palsu untuk test.
- [x] Terapkan kedaluwarsa OTP, batas percobaan, dan jeda kirim ulang.
- [x] Pastikan mode OTP lokal tidak dapat digunakan di production.
- [x] Implementasikan guard autentikasi, verifikasi HP, dan peran admin/pengguna.
- [x] Uji akun duplikat, password salah, token gagal, OTP gagal, dan akses tanpa hak.

**Selesai jika:** alur daftar → login → verifikasi development → profil berjalan; akses terlindungi ditolak sesuai kondisi akun; tidak ada secret atau token sensitif bocor lewat response/log. Migrasi sudah diterapkan pada database development dan test; integration test alur akun, refresh rotation, OTP, dan profil lulus.

### M3 — Marketplace dan aturan listing

- [ ] Selesaikan keputusan wilayah, lifecycle listing, dan interaksi cooldown yang masih terbuka.
- [ ] Buat skema/migrasi listing, tag, kategori, toko, serta constraint satu toko per akun.
- [ ] Implementasikan pembatasan Kota Semarang berdasarkan aturan wilayah yang disepakati.
- [ ] Integrasikan upload Cloudinary dengan otorisasi, batas file, dan pengujian menggunakan adapter palsu.
- [ ] Implementasikan daftar/detail listing, pencarian, filter, dan pagination.
- [ ] Implementasikan pembuatan/perubahan listing, izin tag, dan syarat minimal foto.
- [ ] Implementasikan kuota dan masa tayang Personal/Toko/Juragan sesuai `revision.md`.
- [ ] Implementasikan tandai terjual, hapus, perpanjang, dan pengaktifan ulang sesuai lifecycle yang disepakati.
- [ ] Implementasikan cooldown 7 hari/2 hari dan endpoint informasi kuota/cooldown.
- [ ] Implementasikan kedaluwarsa listing dengan job yang aman dijalankan ulang.
- [ ] Uji request bersamaan agar kuota tidak terlampaui dan cooldown tetap konsisten.

**Selesai jika:** alur pengguna terverifikasi → pasang listing → pencarian → kontak WhatsApp → terjual berjalan; seluruh aturan kuota, tag, foto, wilayah, cooldown, dan kedaluwarsa teruji. Tier berbayar belum dapat dibeli pengguna sebelum M4.

**Catatan:** tandai terjual pada tahap ini mengurus status listing dan cooldown. Hubungan pembeli, konfirmasi transaksi, serta hak memberi rating diselesaikan di M5; jangan mengunci desain yang menghalangi alur tersebut.

### M4 — Membership, add-on, dan admin

- [ ] Finalkan upgrade/perpanjangan membership, add-on bertumpuk, dan penonaktifan saat kuota berkurang.
- [ ] Implementasikan daftar paket dan pengajuan upgrade dengan bukti transfer.
- [ ] Implementasikan verifikasi toko serta persetujuan/penolakan admin dengan catatan tindakan.
- [ ] Aktifkan membership 30 hari dari persetujuan admin.
- [ ] Implementasikan kapasitas add-on selama 30 hari yang slotnya dapat dipakai ulang.
- [ ] Implementasikan add-on lewati cooldown sekali pakai, terpisah dari add-on kapasitas.
- [ ] Implementasikan berakhirnya membership/add-on dan penonaktifan listing yang kehilangan hak.
- [ ] Pastikan approval/pemakaian add-on tidak dapat diproses ganda atau melampaui hak saat request bersamaan.
- [ ] Uji batas periode, downgrade, slot berlebih, BNIB/New, dan akses admin.

**Selesai jika:** pengajuan → persetujuan admin → hak aktif → hak berakhir berjalan konsisten dan dapat diaudit. Tidak ada integrasi Midtrans atau pembayaran barang pada milestone ini.

### M5 — Konfirmasi transaksi dan kepercayaan

- [ ] Finalkan pembeli tanpa akun, penolakan konfirmasi, dan koreksi salah pilih pembeli.
- [ ] Hubungkan penandaan terjual dengan pembeli terdaftar dan konfirmasi oleh pembeli.
- [ ] Izinkan satu rating oleh pembeli yang berhak untuk setiap transaksi terkonfirmasi.
- [ ] Implementasikan laporan listing/pengguna dan antrean moderasi admin.
- [ ] Uji rating tanpa transaksi, konfirmasi oleh pihak lain, duplikasi rating, dan akses moderasi.

**Selesai jika:** rating tidak dapat dibuat pengguna sembarang; laporan dapat ditindaklanjuti admin; konfirmasi transaksi tidak diklaim sebagai bukti pembayaran independen.

### M6 — Forum dan MongoDB

- [ ] Tambahkan MongoDB ke lingkungan development dan integrasikan Mongoose.
- [ ] Implementasikan posting, kategori, foto, komentar, dan pagination.
- [ ] Terapkan verifikasi HP untuk posting/komentar; konten publik tetap dapat dibaca.
- [ ] Gunakan identitas PostgreSQL sebagai sumber kebenaran dan referensi di MongoDB.
- [ ] Tambahkan laporan/moderasi posting serta uji otorisasi penulis dan admin.
- [ ] Uji kegagalan MongoDB dan dokumentasikan kebutuhan menjalankan modul forum.

**Selesai jika:** pengguna terverifikasi dapat membuat posting dan komentar dengan hak akses yang benar; forum tidak menjadikan MongoDB sumber kebenaran identitas/tier.

### M7 — Kesiapan uji pengguna dan rilis

- [ ] Selaraskan dan publikasikan dokumentasi API yang memang boleh masuk repositori.
- [ ] Siapkan pemeriksaan otomatis build, lint, dan test di CI.
- [ ] Jalankan pengujian alur utama lintas modul dan regression test.
- [ ] Integrasikan provider OTP nyata sebelum mengandalkan verifikasi nomor pengguna nyata.
- [ ] Tinjau secret, logging, pembatasan request, CORS, dan upload media.
- [ ] Siapkan backup/restore, pemantauan error, deployment, dan prosedur migrasi database.
- [ ] Dokumentasikan keterbatasan, kebutuhan operasional moderasi, serta prasyarat kebijakan privasi/syarat layanan.
- [ ] Lakukan uji tertutup dan catat temuan sebelum rilis publik.

**Selesai jika:** alur utama teruji di lingkungan target, konfigurasi development tidak bocor ke production, dan prosedur operasi dapat dijalankan. Rilis publik memerlukan persetujuan terpisah.

## 4. Gerbang keputusan sebelum implementasi terkait

Jangan mengisi keputusan bisnis yang belum disepakati dengan asumsi tersembunyi. Catat hasilnya di `revision.md` sebelum coding modul tersebut.

| Keputusan | Harus selesai sebelum |
| --- | --- |
| Kebijakan password/token, masa berlaku OTP, batas percobaan, dan jeda kirim ulang | M2 |
| Data wilayah Kota Semarang, alamat wajib, dan cara pemeriksaan kelayakan | M3 |
| Lifecycle pengaktifan ulang/perpanjangan, batch kedaluwarsa, serta penentuan kuota penuh dengan add-on | M3 |
| Tipe/ukuran file, signed upload, kepemilikan dan penghapusan media | Integrasi Cloudinary di M3 |
| Urutan listing yang dinonaktifkan, pengaktifan kembali, dan efek penonaktifan sistem terhadap cooldown | M4 |
| Perpanjangan lebih awal, upgrade di tengah periode, serta prorata | M4 |
| Harga/paket add-on, penumpukan periode, dan cara memakai lewati cooldown | M4 |
| Cooldown saat akun berpindah antara Personal dan tier berbayar | M4 |
| Pembeli tanpa akun, penolakan konfirmasi, dan koreksi pembeli | M5 |
| Provider OTP nyata dan konfigurasi deployment | Uji pengguna nyata/M7 |

## 5. Aturan commit atomik

### Satu commit, satu tujuan logis

- Satu commit menyelesaikan satu perubahan yang dapat dijelaskan, ditinjau, dan di-revert secara mandiri.
- Atomik tidak berarti satu file. Implementasi, migrasi, test, dokumentasi API, dan konfigurasi yang wajib agar perubahan bekerja harus ikut dalam commit yang sama.
- Jangan mencampur fitur berbeda, refactor besar, formatting massal, atau pembaruan dependency yang tidak berkaitan.
- Hindari commit sementara yang meninggalkan build rusak, import belum tersedia, atau endpoint setengah terhubung.
- Jika pekerjaan terlalu besar, pecah menjadi irisan yang tetap berfungsi dan dapat diuji, bukan memisahkan implementasi dari test wajibnya.
- Jangan memasukkan pekerjaan pengguna yang tidak terkait; gunakan staging path/hunk secara selektif, bukan `git add .` tanpa pemeriksaan.
- Lockfile ikut berubah ketika dependency terkait berubah. Migrasi yang diperlukan ikut dengan perubahan skema dan implementasinya.
- Jangan commit `.env`, secret, token, data pribadi, atau dua dokumen referensi lokal yang memang diabaikan Git.

### Contoh irisan commit

Contoh berikut bukan instruksi untuk mengeksekusi semua commit sekaligus. Setiap irisan menyertakan pengujian dan pembaruan dokumentasi yang relevan.

| Perubahan | Contoh subject |
| --- | --- |
| Acuan sistem dan rencana pengembangan | `Document system rules and development milestones` |
| Scaffold beserta konfigurasi build/test dasar | `Initialize NestJS application` |
| Docker PostgreSQL dan petunjuk penggunaannya | `Add Docker PostgreSQL development setup` |
| Integrasi Prisma beserta pemeriksaan koneksi | `Integrate Prisma with PostgreSQL` |
| Validasi environment beserta test dan contoh env | `Validate application environment` |
| Registrasi beserta migrasi akun dan test | `Implement account registration` |
| OTP lokal, pembatasan, dan larangan production | `Add development phone verification` |
| Penegakan kuota yang aman terhadap konkurensi | `Enforce listing quotas transactionally` |
| Aturan cooldown beserta test batas waktunya | `Implement Personal listing cooldowns` |
| Approval admin beserta periode hak dan test | `Add manual membership approval` |

### Format pesan commit

- Gunakan subject bahasa Inggris, imperative, diawali huruf kapital.
- Usahakan maksimal 50 karakter dan jangan akhiri dengan tanda baca.
- Body opsional; gunakan hanya untuk alasan, dampak, atau informasi penting yang belum dijelaskan subject.
- Pisahkan body dengan satu baris kosong dan bungkus sekitar 72 karakter per baris.
- Jangan mengulang subject di body atau memasukkan raw diff.

### Pemeriksaan sebelum commit

1. Periksa status Git dan pastikan perubahan yang dimasukkan hanya untuk satu tujuan.
2. Jalankan test paling spesifik, lalu build/lint atau pengujian lebih luas sesuai dampak.
3. Tinjau staged diff, file baru, migrasi, dan kemungkinan secret.
4. Jalankan `git diff --cached --check`.
5. Perbarui checklist/catatan progres yang relevan tanpa menandai milestone terlalu dini.
6. Buat commit hanya setelah ada instruksi atau otorisasi commit dari pengguna.
7. Jika validasi gagal atau tidak dapat dijalankan, catat kondisi dan penyebabnya; jangan mengklaim lulus. Kegagalan akibat perubahan sendiri diselesaikan sebelum commit.

Dokumen ini **bukan izin otomatis untuk commit, membuat branch, atau push**. Jangan amend/rewrite commit yang sudah ada tanpa instruksi. Push memerlukan instruksi terpisah.

## 6. Aturan pencatatan progres

- `[ ]` berarti belum selesai; `[x]` hanya untuk hasil yang sudah ada dan diverifikasi.
- Status milestone: **Belum dimulai**, **Berjalan**, **Terblokir**, atau **Selesai**.
- Saat terblokir, tuliskan keputusan/dependensi yang menghalangi; lanjutkan bagian independen jika aman.
- Catat perubahan aturan bisnis di `revision.md`, bukan hanya dalam log progres.
- Tandai milestone selesai hanya setelah semua checklist wajib dan kriteria penerimaan terpenuhi.
- Test yang belum dijalankan, timeout, atau gagal harus dicatat apa adanya.
- Estimasi/tanggal target dapat ditambahkan setelah kapasitas pengerjaan disepakati; jangan menganggap urutan milestone sebagai janji durasi.

### Log progres

| Tanggal | Milestone | Hasil | Validasi | Commit |
| --- | --- | --- | --- | --- |
| Belum dicatat | M0 | Git, remote, `.gitignore`, README, dan template env awal | Pemeriksaan ignore, staged whitespace, dan status Git pada inisialisasi | `edeca25` |
| 2026-11-08 | M0 | Acuan sistem dan timeline masuk repositori; README selaras; berhenti sebelum M1 | Tinjauan konsistensi dokumen, aturan ignore, dan pemeriksaan whitespace Git; test aplikasi tidak dijalankan karena belum ada aplikasi | Commit checkpoint yang memuat baris ini |
| 2026-11-09 | M1 | `.env.example` diselaraskan ke URL PostgreSQL port 5433 dan variabel MongoDB dihapus; M1 ditutup | `npm run db:validate`, build, lint, unit test, dan e2e lulus pada validasi sesi; diff Git ditinjau karena file tidak dapat dibuka langsung oleh editor | Belum di-commit |
| 2026-11-09 | M2 | Implementasi akun, autentikasi, token, profil, OTP, dan migrasi; migrasi diterapkan ke `aquaku` serta `aquaku_test` | 117 unit, 63 e2e, 7 integration test lulus; `db:status` menunjukkan database development up to date | Belum di-commit |

### Checkpoint M1

| Checkpoint | Hasil dan validasi | Commit |
| --- | --- | --- |
| M1.1 — Scaffold | Node 24.22.2, npm 11, NestJS 11, TypeScript, lockfile, build/lint lulus, 1 unit test dan 1 e2e test lulus. Audit production: 0; audit keseluruhan: 30 temuan tooling development (2 low, 28 moderate), perlu ditinjau. | `Initialize NestJS application` |

| M1.2 — Docker PostgreSQL | Compose valid; Docker Desktop aktif; PostgreSQL 17.11 healthy; koneksi psql dan query database berhasil. Named volume dan port loopback didokumentasikan. | `Add Docker PostgreSQL development setup` |

| M1.3 — Konfigurasi dan HTTP | Build/lint lulus; 85 unit test dan 56 e2e test lulus; konfigurasi invalid ditolak tanpa membocorkan nilai sensitif, prefix/DTO/error/CORS teruji; audit production 0. Template env masih terblokir dan belum ditandai selesai. | `Validate configuration and HTTP requests` |

| M1.2a — Port database host | Pengujian host menemukan autentikasi berbeda di port 5432; mapping dipindah ke loopback 5433. Compose melaporkan `127.0.0.1:5433`; koneksi host melalui Prisma berhasil. Port internal dan volume tetap sama. | `Isolate the development PostgreSQL host port` |

| M1.3a — Error middleware HTTP | Review menemukan payload/encoding gagal diklasifikasikan 500. Kini body-parser mempertahankan 413/415 tanpa membuka detail exception; scoped lint dan 60 e2e test HTTP lulus. | `Preserve HTTP middleware error statuses` |

| M1.4 — Prisma dan readiness | Prisma 7.10.1; generate/skema/build/lint lulus; baseline diterapkan ke database kosong dan deploy kedua tanpa pending migration. 89 unit, 63 e2e, serta 6 integration test lulus, termasuk startup hasil build, konfigurasi invalid, query nyata, dan readiness gagal saat DB tidak terjangkau. | `Integrate Prisma and database readiness` |

| M1.5 — Verifikasi clone bersih | Clone lokal commit `3549c93`: `npm ci`, deploy/status migrasi, generate/build, lint, coverage unit, e2e, integration, dan audit production lulus. 89 unit, 63 e2e, 6 integration test; coverage unit 71,11% statement (HTTP diuji terpisah melalui e2e). Audit production 0; 30 temuan tooling development tetap dicatat. | `Record M1 verification and remaining blocker` |

Validasi historis memakai executable Node 24 melalui npm exec karena Node global komputer masih v25. `.env.example` diperbarui oleh pengguna; akses baca penuh tetap dibatasi `private_files`, sehingga pemeriksaan perubahan memakai diff Git. Pada 2026-11-09 migrasi berhasil diterapkan ke database development dan test tanpa reset/drop.

### Checkpoint M2

| Checkpoint | Hasil dan validasi | Status |
| --- | --- | --- |
| M2.1 — Akun dan autentikasi | Skema/migrasi akun, scrypt, normalisasi email/nomor HP, registrasi, login, JWT access, refresh rotation, profil, guard, serta OTP development dan fake sender. Kebijakan dicatat di `revision.md`. | Migrasi berhasil diterapkan pada `aquaku` dan `aquaku_test`; unit test 117, e2e 63, integration test 7 lulus; lint/build/schema validation lulus. M2 selesai. Perubahan belum di-commit. |

Tanggal historis tidak diisi dengan perkiraan. Tambahkan tanggal aktual pada pembaruan progres berikutnya.

## 7. Di luar prioritas awal

- OAuth.
- Midtrans dan otomatisasi pembayaran platform.
- Checkout, escrow, dan payment gateway transaksi barang.
- Tank profile atau fitur unggulan lain sebelum kebutuhan inti siap.
- Redis, microservices, aplikasi mobile, serta pencarian eksternal.

Penambahan scope tersebut harus disepakati dan dicatat sebelum mengubah timeline.
