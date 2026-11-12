# Revisi Acuan Sistem Aquaku Backend

Dokumen ini merangkum keputusan hasil pembahasan untuk menjadi acuan implementasi backend. Aturan di sini menggantikan bagian yang bertentangan dalam dokumen konsep dan draft OpenAPI lokal. Bagian yang belum diputuskan tidak boleh dianggap sebagai aturan final.

## 1. Ruang lingkup dan status

- Backend untuk forum komunitas dan marketplace aquascape.
- Peluncuran awal dibatasi oleh sistem untuk **Kota Semarang**, bukan Kabupaten Semarang.
- Fondasi akun/marketplace PostgreSQL telah selesai; integrasi forum MongoDB/Mongoose berada pada milestone M6.
- Status checklist dan validasi implementasi terbaru dicatat di `timeline.md` dan `README.md`.
- Dokumen ini menjadi acuan keputusan sistem; fitur yang belum disebut sebagai tersedia tetap dianggap belum diimplementasikan.

## 2. Stack dan arsitektur

| Komponen | Keputusan |
| --- | --- |
| Bahasa | TypeScript |
| Framework backend | NestJS |
| Database utama | PostgreSQL |
| ORM PostgreSQL | Prisma |
| Database forum | MongoDB dengan Mongoose |
| Lingkungan development | Docker, PostgreSQL dan MongoDB |
| Kontrak API | REST + JSON dengan prefix `/api/v1` |
| Autentikasi | JWT Bearer sesuai draft OpenAPI |
| Media | Cloudinary, integrasi pada tahap upload |

Mulai dari satu layanan backend modular, bukan microservices. PostgreSQL menjadi sumber kebenaran untuk identitas, tier, dan aturan marketplace. Validasi hak akses, kuota, cooldown, dan tag dilakukan di backend, bukan dipercayakan kepada frontend.

### Pembagian data

- **PostgreSQL:** akun, membership, toko dan verifikasinya, listing, tag, kuota, cooldown, pembelian add-on, rating, laporan, dan catatan persetujuan admin.
- **MongoDB:** kategori, posting, komentar, laporan, dan jejak moderasi forum. Tank profile belum menjadi cakupan.
- **Cloudinary:** foto forum/listing; PostgreSQL mencatat kepemilikan dan metadata asset, MongoDB merujuk ID asset pada posting.

Dokumen MongoDB merujuk UUID pengguna PostgreSQL. Profil penulis dibaca dari PostgreSQL; salinan data MongoDB tidak menggantikan sumber kebenaran identitas/tier.

## 3. Akun dan autentikasi

- Registrasi dan login mengikuti draft YAML: email dan password, dengan nomor HP untuk verifikasi.
- Satu nomor HP hanya boleh dipakai oleh satu akun.
- Satu akun hanya boleh mempunyai satu toko.
- Akun baru mendapat tier Personal.
- Mendukung access token dan refresh token.
- OAuth belum diimplementasikan; dapat ditambahkan kemudian.

### Kebijakan keamanan akun M2

- Password menerima 12–128 karakter; tidak ada aturan komposisi wajib. Hash menggunakan scrypt dengan salt acak per akun.
- Access token JWT berlaku 15 menit. Refresh token JWT berlaku 30 hari, diputar setiap digunakan, dan dapat dipakai sekali; hash token disimpan agar token yang sudah dipakai/dicabut ditolak.
- Secret access dan refresh harus berbeda dan minimal 32 karakter acak pada production. Development/test tanpa secret memakai secret acak sementara per proses; semua sesi invalid setelah proses dimulai ulang.
- Nomor HP Indonesia menerima format lokal `08...`, `62...`, atau `+62...`, lalu disimpan ternormalisasi sebagai `+62...`.
- OTP development berisi 6 digit, berlaku 5 menit, maksimal 5 percobaan per kode, dan pengiriman ulang dibatasi jeda 60 detik. Kode hanya ditampilkan oleh kanal HTTP lokal development/test, tidak dikirim ke nomor asli dan tidak dicatat ke log.

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

- Lokasi yang wajib divalidasi adalah lokasi pada setiap listing, dipilih dari kode kelurahan yang tercatat di backend. Daftar mencakup 16 kecamatan dan 177 kelurahan Kota Semarang.
- Referensi nama wilayah: [Data Kelurahan Kota Semarang](https://datakelurahan.semarangkota.go.id/). Kode kelurahan pada snapshot awal mengikuti daftar Kemendagri No. 56 Tahun 2015; tinjau ulang terhadap dataset kode wilayah terbaru sebelum rilis pengguna nyata.
- API menampilkan kecamatan dan kelurahan; alamat rinci tidak diwajibkan atau ditampilkan publik.
- Ini membatasi lokasi yang dicantumkan pada listing, bukan membuktikan lokasi fisik penjual. Alamat yang diisi sendiri, IP, dan GPS tidak dianggap bukti lokasi fisik.

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

- Harga dan batas di atas boleh dipakai sebagai nilai awal implementasi MVP, tetapi masih merupakan hipotesis bisnis yang perlu divalidasi.

### Pembayaran dan masa berlaku

- Pembayaran awal melalui transfer dengan bukti pembayaran.
- Pengajuan upgrade dan add-on diperiksa serta disetujui admin.
- Hak berbayar aktif setelah persetujuan admin, bukan hanya setelah pengajuan atau upload bukti.
- Masa membership dihitung **30 hari sejak verifikasi/persetujuan admin**, bukan mengikuti awal/akhir bulan kalender.
- Midtrans merupakan rencana integrasi berikutnya, bukan bagian tahap fondasi.

Perpanjangan tier yang sama yang disetujui sebelum masa aktif habis menambahkan 30 hari dari tanggal kedaluwarsa saat ini. Jika membership sudah habis, masa baru dimulai saat persetujuan. Upgrade ke tier lebih tinggi berlaku segera sejak persetujuan dengan periode 30 hari baru; tidak ada prorata/refund dan sisa waktu tier lama tidak dibawa.

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

- Kondisi Second/Like New memerlukan minimal tiga foto; BNIB/New memerlukan minimal satu foto.
- Foto menerima JPEG, PNG, atau WebP, maksimal 5 MB per foto dan 8 foto per listing. Upload memakai signed upload Cloudinary; backend memverifikasi aset dan ukurannya sebelum dikaitkan ke listing. Upload preset Cloudinary wajib dikonfigurasi dengan batas 5 MB dan format yang sama; backend tetap menolak hasil upload yang melanggar batas.
- Penghapusan foto dilakukan melalui endpoint pemilik aset yang juga menghapus file Cloudinary secara idempoten. Memperbarui `photo_ids` tidak melepas foto lama secara diam-diam; foto lama harus dihapus eksplisit agar tidak menjadi aset yatim.
- Kategori awal yang di-seed: Tanaman air, Hewan air, Peralatan, Hardscape, Akuarium, dan Lainnya. Kondisi merupakan tag terkontrol; daftar awal BNIB, Baru, Like New, dan Second.
- Filter listing mencakup teks judul/deskripsi, kategori, kondisi, rentang harga, kecamatan/kelurahan; urutan tersedia berdasarkan terbaru atau harga. Pagination default 20 dan maksimal 50 item.
- Listing aktif berlaku 30 hari untuk Personal, 60 hari untuk Toko, dan 90 hari untuk Juragan. Masa membership berbayar harus aktif agar tier berbayar berlaku.
- Status listing yang tersimpan adalah Active, Sold, Expired, dan Inactive (penangguhan sistem). Penghapusan penjual memakai soft delete dan tidak tampil di publik atau dihitung dalam kuota; foto listing arsip dipertahankan. Listing Sold tidak dapat diaktifkan kembali.
- Perpanjangan hanya untuk listing Expired, berlaku dari waktu permintaan setelah validasi ulang. Listing aktif tidak dapat diperpanjang lebih awal.
- Job kedaluwarsa berjalan per menit, idempoten, dan memproses batch. Pemasangan, pengaktifan ulang, penjualan, kedaluwarsa, dan penghapusan memakai transaksi serta lock per akun agar kuota/cooldown konsisten terhadap request bersamaan.
- Kuota listing adalah kapasitas dasar tier ditambah slot add-on yang masih berlaku. Grant slot berjalan terpisah selama 30 hari dan slot dapat dipakai ulang.
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
| Pengguna menghapus listing Inactive yang ditangguhkan sistem | Soft delete tanpa cooldown tambahan |
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
| Menghapus listing aktif | Ya, dengan konsekuensi cooldown di atas |
| Menghapus listing Inactive | Ya, tanpa cooldown tambahan |
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

- Berlaku 30 hari sejak persetujuan dan bersifat sekali pakai.
- Mengakhiri cooldown saat digunakan pada request pembuatan listing yang berhasil.
- Tidak menambah kapasitas listing dan harus dipilih eksplisit melalui `cooldown_pass_id`.

Harga add-on belum ditetapkan dan tidak di-hardcode; pemohon mengisi nominal transfer dan admin menetapkan jumlah slot yang disetujui. Jumlah permintaan slot dibatasi 1–1000 demi batas operasional MVP. Setiap persetujuan kapasitas membuat grant terpisah 30 hari; kapasitas aktif dijumlahkan dan masa tiap grant berjalan sendiri. Add-on lewati cooldown berlaku 30 hari, dipilih eksplisit saat membuat listing selama cooldown, dan baru terpakai jika pembuatan listing berhasil.

## 9. Membership/add-on habis dan penonaktifan

- Membership berbayar yang habis membuat hak akun kembali mengikuti Personal, dengan memperhitungkan add-on yang masih berlaku.
- Listing yang tidak lagi memenuhi hak langganan dinonaktifkan, bukan dihapus permanen.
- Termasuk listing BNIB/New ketika akun kehilangan hak menjual barang baru dan listing yang melebihi kapasitas aktif yang tersedia.
- Listing yang masih memenuhi hak akun tidak perlu dinonaktifkan seluruhnya.
- Berakhirnya add-on memakai prinsip penonaktifan yang sama jika jumlah listing aktif melebihi kapasitas baru.
- Pengaktifan ulang tidak otomatis melewati validasi tier, kuota, cooldown, foto, atau masa tayang.

Saat hak berkurang, listing BNIB/New dinonaktifkan lebih dulu jika tier menjadi Personal. Jika listing lain masih melebihi kuota, listing yang paling baru dibuat dinonaktifkan sampai kuota sesuai; listing lama diprioritaskan. Status Inactive menyimpan alasan dan waktu penonaktifan sistem serta membekukan sisa masa tayang. Pengaktifan ulang dilakukan manual setelah hak kembali dan tetap memeriksa tier, kuota, foto, dan cooldown. Penonaktifan otomatis tidak memicu cooldown.

### Pengajuan, bukti transfer, dan verifikasi toko

- Pengajuan membership/add-on wajib menyertakan bukti transfer JPEG/PNG/PDF maksimal 5 MB. Isi bukti disimpan privat di PostgreSQL dan hanya dapat diunduh admin; endpoint daftar tidak menyertakan isi berkas.
- Satu pengajuan Pending per akun dan jenis manfaat. Setelah ditolak, pengguna boleh mengajukan ulang.
- Harga membership harus sama dengan katalog; harga add-on tidak ditetapkan sistem dan diverifikasi manual oleh admin.
- Penolakan wajib mencatat alasan. Reviewer, waktu, keputusan, alasan, serta hak yang diberikan disimpan pada pengajuan; keputusan final idempoten.
- Verifikasi toko adalah badge kepercayaan manual, bukan syarat untuk hak tier. MVP tidak meminta dokumen identitas resmi.

## 10. Transaksi, rating, laporan, dan moderasi

### Transaksi MVP

- Pembeli menghubungi penjual melalui WhatsApp; transaksi tetap dilakukan di luar platform melalui COD/meetup atau pengiriman lokal.
- Penjual dapat menandai listing terjual tanpa akun pembeli; transaksi tersebut tidak terhubung ke akun dan tidak dapat diberi rating.
- Jika penjual menghubungkan pembeli, pembeli harus mempunyai akun dengan HP terverifikasi. Status menunggu konfirmasi, pembeli dapat mengonfirmasi atau menolak; penolakan tidak mengaktifkan listing kembali.
- Penjual dapat membatalkan transaksi yang masih menunggu jawaban atau mengganti pembeli sebelum konfirmasi. Listing tetap berstatus Sold.
- Setelah dikonfirmasi, koreksi pembeli hanya oleh admin dengan alasan audit; koreksi membatalkan rating sebelumnya dan meminta konfirmasi pembeli baru.
- Tidak ada batas waktu otomatis untuk konfirmasi. Transaksi barang tidak memakai checkout, escrow, atau payment gateway; Midtrans bukan bagian milestone ini.

### Rating

- Hanya pembeli dari transaksi Confirmed yang boleh memberi rating angka 1–5; komentar teks tidak termasuk MVP.
- Satu rating per transaksi. Pengiriman ulang skor yang sama idempoten; perubahan rating setelah dibuat ditolak.
- Jika admin mengoreksi pembeli, rating yang terkait dihapus dan pembeli baru harus mengonfirmasi sebelum dapat memberi rating.
- Profil publik menampilkan nilai rata-rata, jumlah rating, dan jumlah listing aktif.

### Laporan dan moderasi

- Pengguna dengan HP terverifikasi dapat melaporkan listing/pengguna memakai alasan terkontrol: spam, scam, barang terlarang, menyesatkan, pelecehan, atau lainnya.
- Satu laporan Open per pelapor/target; setelah ditinjau, admin menandai Resolved atau Dismissed dengan catatan. Laporan pengguna tidak otomatis menangguhkan akun.
- Admin dapat menyembunyikan listing aktif dan memulihkannya, wajib memberi alasan; semua tindakan masuk audit.
- Listing tersembunyi tidak tampil publik tetapi tetap memakai kuota dan tetap mengikuti masa tayang. Moderasi akun/pengguna ditunda.
- Konfirmasi pembeli dan rating bukan bukti pembayaran independen dan tidak sepenuhnya mencegah kolusi.

## 11. Forum, media, dan fitur berikutnya

- Forum menyediakan kategori yang dikelola admin, posting, foto Cloudinary, komentar, pagination, laporan, dan moderasi posting hide/restore.
- Membaca konten forum bersifat publik; membuat posting, komentar, atau laporan memerlukan HP terverifikasi.
- Foto memakai signed upload Cloudinary dan verifikasi backend atas kepemilikan, format JPEG/PNG/WebP, serta batas ukuran 5 MB.
- MongoDB menyimpan konten; UUID dan profil pengguna tetap bersumber dari PostgreSQL.
- OAuth, Midtrans, dan tank profile belum menjadi cakupan implementasi.

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

- `openapi.yaml` adalah kontrak API yang dipublikasikan dan diperbarui bersama implementasi. Draft `openapi-aquascape.yaml` lokal tetap hanya referensi dan tidak tersedia dalam clone.
- Kontrak `openapi.yaml` diperbarui bersama M5 untuk konfirmasi transaksi, rating, laporan, moderasi, audit admin, dan profil publik; kontrak menjadi acuan integrasi frontend marketplace.
- Uji batas waktu cooldown/membership/add-on, penurunan hak akun, otorisasi, dan konsistensi kuota.
- Kredensial asli, OTP pengguna nyata, dan secret tidak boleh masuk Git atau log production.
- Pembuatan dokumen ini tidak mencakup scaffold aplikasi, commit, atau push.
