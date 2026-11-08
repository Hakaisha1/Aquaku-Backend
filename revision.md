# Revisi Acuan Sistem Aquaku Backend

Dokumen ini merangkum keputusan hasil pembahasan untuk menjadi acuan implementasi backend. Aturan di sini menggantikan bagian yang bertentangan dalam dokumen konsep dan draft OpenAPI lokal. Bagian yang belum diputuskan tidak boleh dianggap sebagai aturan final.

## 1. Ruang lingkup dan status

- Backend untuk forum komunitas dan marketplace aquascape.
- Peluncuran awal dibatasi oleh sistem untuk **Kota Semarang**, bukan Kabupaten Semarang.
- Fokus implementasi pertama adalah PostgreSQL dan fitur utama akun/marketplace.
- Forum berbasis MongoDB menyusul; tidak menjadi prasyarat tahap fondasi.
- Dokumen ini adalah spesifikasi, bukan pernyataan bahwa fitur sudah diimplementasikan.

## 2. Stack dan arsitektur

| Komponen | Keputusan |
| --- | --- |
| Bahasa | TypeScript |
| Framework backend | NestJS |
| Database utama | PostgreSQL |
| ORM PostgreSQL | Prisma |
| Database forum, tahap berikutnya | MongoDB dengan Mongoose |
| Lingkungan development | Docker, termasuk PostgreSQL |
| Kontrak API | REST + JSON dengan prefix `/api/v1` |
| Autentikasi | JWT Bearer sesuai draft OpenAPI |
| Media | Cloudinary, integrasi pada tahap upload |

Mulai dari satu layanan backend modular, bukan microservices. PostgreSQL menjadi sumber kebenaran untuk identitas, tier, dan aturan marketplace. Validasi hak akses, kuota, cooldown, dan tag dilakukan di backend, bukan dipercayakan kepada frontend.

### Pembagian data

- **PostgreSQL:** akun, membership, toko dan verifikasinya, listing, tag, kuota, cooldown, pembelian add-on, rating, laporan, dan catatan persetujuan admin.
- **MongoDB, tahap berikutnya:** posting forum, komentar, dan tank profile jika fitur tersebut dipilih.
- **Cloudinary:** file media; database menyimpan URL dan metadata yang diperlukan.

Dokumen MongoDB merujuk ID pengguna/listing dari PostgreSQL. Salinan data tampilan di MongoDB tidak menggantikan sumber kebenaran PostgreSQL.

## 3. Akun dan autentikasi

- Registrasi dan login mengikuti draft YAML: email dan password, dengan nomor HP untuk verifikasi.
- Satu nomor HP hanya boleh dipakai oleh satu akun.
- Satu akun hanya boleh mempunyai satu toko.
- Akun baru mendapat tier Personal.
- Mendukung access token dan refresh token.
- OAuth belum diimplementasikan; dapat ditambahkan kemudian.

### Hak akses berdasarkan verifikasi HP

| Aktivitas | Verifikasi HP |
| --- | --- |
| Membaca konten publik | Tidak wajib |
| Membuat posting dan komentar | Wajib |
| Memasang listing | Wajib |

Verifikasi HP tidak otomatis berarti toko sudah terverifikasi. Verifikasi toko merupakan proses terpisah.

### OTP prototipe

Untuk development, gunakan pengirim OTP lokal tanpa biaya pengiriman SMS/WhatsApp:

- Kode dibuat secara acak.
- Tetap ada masa kedaluwarsa, batas percobaan, dan jeda kirim ulang.
- Kode tersedia melalui kanal development lokal, bukan dikirim ke nomor asli.
- Pengujian otomatis menggunakan pengirim OTP palsu.
- Mode OTP lokal tidak boleh aktif di production.

OTP development menguji alur aplikasi, **bukan membuktikan kepemilikan nomor HP asli**. Provider OTP nyata belum dipilih dan diperlukan sebelum verifikasi dipakai oleh pengguna nyata. Nilai masa berlaku, batas percobaan, dan jeda kirim ulang belum difinalkan.

## 4. Batas wilayah

Kota Semarang menjadi batas sistem pada tahap awal, bukan hanya fokus pemasaran.

Detail penerapan masih perlu ditetapkan sebelum modul alamat/listing dibuat: sumber daftar wilayah, data alamat yang wajib, dan cara memeriksa kelayakan pengguna/toko/listing. Jangan menganggap isian alamat atau lokasi IP sebagai bukti lokasi fisik pengguna.

## 5. Membership penjual

Forum tidak dibatasi oleh membership berbayar. Membership membedakan hak berjualan.

| Ketentuan | Personal | Toko | Juragan |
| --- | --- | --- | --- |
| Harga per periode | Gratis | Rp40.000 | Rp100.000 |
| Periode berbayar | Tidak berlaku | 30 hari | 30 hari |
| Kuota dasar listing aktif | 5 | 30 | 100 |
| Masa tayang listing | 30 hari | 60 hari | 90 hari |
| Cooldown Personal | Berlaku | Tidak berlaku selama membership aktif | Tidak berlaku selama membership aktif |
| Menjual barang BNIB/New | Tidak | Ya | Ya |

Harga dan batas di atas boleh dipakai sebagai nilai awal implementasi MVP, tetapi masih merupakan hipotesis bisnis yang perlu divalidasi.

### Pembayaran dan masa berlaku

- Pembayaran awal melalui transfer dengan bukti pembayaran.
- Pengajuan upgrade dan add-on diperiksa serta disetujui admin.
- Hak berbayar aktif setelah persetujuan admin, bukan hanya setelah pengajuan atau upload bukti.
- Masa membership dihitung **30 hari sejak verifikasi/persetujuan admin**, bukan mengikuti awal/akhir bulan kalender.
- Midtrans merupakan rencana integrasi berikutnya, bukan bagian tahap fondasi.

Aturan perpanjangan lebih awal, upgrade saat periode masih aktif, serta prorata belum ditentukan.

## 6. Listing dan validasi

Sebelum membuat listing, backend harus memeriksa:

1. Autentikasi valid dan nomor HP sudah diverifikasi.
2. Kelayakan wilayah sesuai aturan Kota Semarang.
3. Tag barang diizinkan untuk tier pengguna.
4. Foto memenuhi aturan kondisi barang.
5. Tidak ada cooldown yang menghalangi.
6. Tersedia kapasitas listing aktif.
7. Masa tayang ditetapkan sesuai tier.

Aturan tambahan:

- Kondisi Second/Like New memerlukan minimal tiga foto sesuai konsep awal.
- Kuota dihitung dari listing berstatus aktif, ditambah kapasitas add-on yang masih berlaku.
- Perpanjangan, pengaktifan ulang, dan pemasangan baru harus memeriksa ulang kelayakan yang relevan; tidak boleh menjadi jalan pintas melewati kuota atau cooldown.
- Pengecekan kuota dan pembuatan/pengaktifan listing harus konsisten terhadap request bersamaan, menggunakan transaksi dan kontrol konkurensi yang sesuai.
- Listing yang sudah terjual tidak diubah kembali menjadi tersedia hanya untuk menghindari aturan pemasangan.

## 7. Cooldown Personal

### Prinsip

Cooldown adalah masa tunggu **di tingkat akun Personal**, bukan per listing. Cooldown membatasi pemasangan atau pengaktifan listing, tetapi tidak menyembunyikan semua listing yang sedang aktif.

Kuota dan cooldown adalah dua pemeriksaan terpisah. Pengguna perlu slot kosong **dan** tidak sedang cooldown untuk memasang listing.

### Pemicu

| Kejadian | Dampak |
| --- | --- |
| Kuota aktif penuh tanpa ada listing terjual/kedaluwarsa | Tidak memulai cooldown; pemasangan tetap ditolak karena kuota penuh |
| Listing terjual/kedaluwarsa saat kuota sebelumnya penuh | Memulai cooldown 7 hari |
| Listing terjual/kedaluwarsa saat kuota sebelumnya belum penuh | Tidak memulai cooldown 7 hari |
| Penjualan/kedaluwarsa berikutnya selama cooldown yang sama | Tidak mengulang hitungan 7 hari |
| Pengguna menghapus listing yang masih aktif | Memicu cooldown 2 hari, meskipun kuota belum penuh |
| Pengguna menghapus arsip listing terjual/kedaluwarsa | Tidak memicu cooldown tambahan |

Jika ada cooldown lama lalu terjadi penghapusan listing aktif, waktu selesai menjadi waktu yang paling akhir antara cooldown lama dan dua hari sejak penghapusan. Cooldown baru tidak boleh memperpendek cooldown lama.

### Contoh

1. Akun Personal mempunyai 5/5 listing aktif. Belum ada cooldown.
2. Senin pukul 10.00, satu listing terjual. Kuota menjadi 4/5 dan cooldown berakhir Senin berikutnya pukul 10.00.
3. Selasa, listing lain terjual. Akhir cooldown tetap Senin berikutnya pukul 10.00.
4. Jika saat cooldown tersisa lima hari pengguna menghapus listing aktif, akhir cooldown tetap sama.
5. Jika saat cooldown tersisa satu hari pengguna menghapus listing aktif, akhir cooldown menjadi dua hari sejak penghapusan.

### Aktivitas selama cooldown

| Aktivitas | Diizinkan |
| --- | --- |
| Membuat listing baru | Tidak |
| Mengaktifkan kembali listing nonaktif/kedaluwarsa | Tidak |
| Memperpanjang listing kedaluwarsa | Tidak |
| Mengubah detail listing yang masih aktif | Ya, tetap mengikuti validasi dan tanpa mereset masa tayang |
| Menandai listing terjual | Ya |
| Menghapus listing | Ya, dengan konsekuensi cooldown di atas |
| Menggunakan forum dan beraktivitas sebagai pembeli | Ya, sesuai hak akses akun |

Listing aktif tetap mengikuti jadwal kedaluwarsanya. Toko/Juragan dengan membership aktif tidak terkena cooldown Personal.

## 8. Add-on

### Slot tambahan

- Menambah kapasitas akun selama **30 hari sejak persetujuan admin**.
- Bukan sejumlah kesempatan sekali pakai untuk membuat listing.
- Slot boleh dipakai ulang selama add-on masih berlaku, dengan tetap mematuhi cooldown dan aturan lain.
- Pembelian slot **tidak menghapus cooldown**.
- Saat add-on habis, kuota berlebih ditangani dengan aturan penonaktifan pada bagian berikutnya.

### Lewati cooldown

- Bersifat sekali pakai.
- Mengakhiri cooldown saat digunakan.
- Tidak menambah kapasitas listing.

Harga/paket slot, aturan penumpukan beberapa add-on, dan mekanisme penggunaan add-on lewati cooldown belum difinalkan.

## 9. Membership/add-on habis dan penonaktifan

- Membership berbayar yang habis membuat hak akun kembali mengikuti Personal, dengan memperhitungkan add-on yang masih berlaku.
- Listing yang tidak lagi memenuhi hak langganan dinonaktifkan, bukan dihapus permanen.
- Termasuk listing BNIB/New ketika akun kehilangan hak menjual barang baru dan listing yang melebihi kapasitas aktif yang tersedia.
- Listing yang masih memenuhi hak akun tidak perlu dinonaktifkan seluruhnya.
- Berakhirnya add-on memakai prinsip penonaktifan yang sama jika jumlah listing aktif melebihi kapasitas baru.
- Pengaktifan ulang tidak otomatis melewati validasi tier, kuota, cooldown, foto, atau masa tayang.

**Belum diputuskan:** urutan pemilihan listing jika jumlah listing yang memenuhi syarat masih melebihi kuota; apakah pengaktifan ulang dilakukan manual/otomatis setelah hak kembali; serta apakah penonaktifan oleh sistem memicu cooldown. Jangan menyamakan penonaktifan sistem dengan penghapusan oleh pengguna tanpa keputusan tambahan.

## 10. Transaksi dan rating

### Transaksi MVP

- Pembeli menghubungi penjual melalui WhatsApp.
- Transaksi dilakukan melalui COD/meetup atau pengiriman lokal sesuai kesepakatan.
- Belum ada checkout, escrow, atau payment gateway untuk transaksi barang.
- Rencana Midtrans untuk pembayaran platform tidak otomatis berarti pembayaran barang/escrow masuk scope.

### Rating berbasis konfirmasi

1. Penjual menandai listing terjual dan menunjuk pembeli yang mempunyai akun.
2. Pembeli mengonfirmasi transaksi.
3. Pembeli tersebut dapat memberi satu rating untuk transaksi yang dikonfirmasi.

Rating tidak dibuka bagi sembarang pengguna. Konfirmasi kedua pihak mengurangi penyalahgunaan, tetapi bukan bukti pembayaran independen dan tidak sepenuhnya mencegah kolusi.

Draft endpoint mark-sold/rating perlu disesuaikan saat modul transaksi dibuat. Aturan penolakan konfirmasi, transaksi dengan pembeli tanpa akun, dan koreksi salah pilih pembeli belum difinalkan.

## 11. Forum, media, dan fitur berikutnya

- Forum: posting, kategori, foto, dan komentar setelah fondasi marketplace siap.
- Verifikasi HP wajib untuk posting dan komentar.
- Integrasi media menggunakan Cloudinary, bukan mengasumsikan mekanisme presigned URL S3 dalam draft YAML cocok tanpa perubahan.
- Detail signed upload, pembatasan tipe/ukuran file, serta otorisasi penghapusan media ditentukan saat modul upload dibuat.
- Tank profile merupakan kandidat fitur unggulan, belum kewajiban tahap fondasi.
- OAuth, MongoDB, Midtrans, dan provider OTP nyata tidak dimasukkan ke implementasi fondasi hanya karena disebut dalam rencana.

## 12. Tahapan implementasi

### Tahap 1 — Fondasi

- Scaffold NestJS + TypeScript.
- Docker untuk lingkungan development PostgreSQL.
- Konfigurasi Prisma dan mekanisme migrasi.
- Validasi environment saat startup.
- Prefix `/api/v1`.
- Validasi request dan format error konsisten.
- Health check.
- Pengujian dasar dan dokumentasi menjalankan proyek dari clone baru.

### Tahap 2 — Akun

- Registrasi, login, refresh token, dan profil.
- Keunikan email/nomor HP serta normalisasi nomor HP.
- OTP development dan pembatasan akses akun belum terverifikasi.
- Peran pengguna/admin dan otorisasi.

### Tahap 3 — Marketplace utama

- Finalisasi detail wilayah dan aturan bisnis yang masih terbuka.
- Listing, tag, pencarian, dan integrasi Cloudinary sesuai kebutuhan foto.
- Kuota, cooldown, masa tayang, dan job kedaluwarsa.
- Pengujian aturan bisnis dan request bersamaan.

### Tahap 4 — Hak berbayar dan admin

- Pengajuan upgrade/add-on dan bukti pembayaran.
- Verifikasi admin, periode hak berbayar, dan penonaktifan saat hak habis.
- Moderasi dasar dan pencatatan tindakan admin.

### Tahap 5 — Komunitas dan kepercayaan

- MongoDB, forum, dan komentar.
- Konfirmasi transaksi, rating, laporan, dan moderasi terkait.
- Fitur unggulan setelah prioritas tervalidasi.

## 13. Penyesuaian dokumentasi dan pengujian

- Draft OpenAPI lokal masih menjadi referensi endpoint dasar, bukan kontrak final yang sudah memuat seluruh revisi.
- Perbarui kontrak API saat implementasi menambahkan konfirmasi transaksi, status nonaktif, aturan upload Cloudinary, dan aturan lainnya.
- Uji batas waktu cooldown/membership/add-on, penurunan hak akun, otorisasi, dan konsistensi kuota.
- Kredensial asli, OTP pengguna nyata, dan secret tidak boleh masuk Git atau log production.
- Pembuatan dokumen ini tidak mencakup scaffold aplikasi, commit, atau push.
