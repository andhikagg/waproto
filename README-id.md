# waproto

[🇬🇧 English](README.md) · 🇮🇩 Bahasa Indonesia

Repo ini otomatis membuat definisi protobuf WhatsApp terbaru dari
[wppconnect-team/wa-proto](https://github.com/wppconnect-team/wa-proto) dalam
format yang cocok untuk [Baileys](https://github.com/WhiskeySockets/Baileys),
lengkap dengan patcher satu baris untuk memasangnya ke proyekmu.

> Tidak resmi. Tidak ada hubungannya dengan WhatsApp maupun Meta.

## Cara kerja

1. Workflow GitHub Actions mengecek repo upstream setiap jam.
2. Kalau ada commit baru, workflow menjalankan `update.sh` untuk `WAProto.proto`
   dari commit itu. Skrip ini akan:
   - mengunduh `WAProto.proto` dan memastikan isinya memang file `.proto`
   - mengganti `required` (tidak valid di proto3) jadi `optional`, hanya di deklarasi field
   - mengompilasinya dengan `pbjs` (output ES module) dan membuat typings dengan `pbts`
   - mengganti namespace `waproto` jadi `proto` di `index.js` **dan** `index.d.ts`,
     plus beberapa penyesuaian khusus Baileys
   - mengecek sintaks hasil build
   - membuat zip dari hasilnya
3. Hasilnya di-commit ke `WAProto/`, dan zip-nya diunggah sebagai artifact workflow.
4. Di komputermu, dua skrip kecil memasang semuanya ke `node_modules`:
   - `fix.js` memperbarui runtime `protobufjs` di dalam modul Baileys
   - `patch.js` memasang file `WAProto` hasil build

## Mulai cepat

Jalankan kedua perintah ini di root proyek Baileys-mu, **berurutan**.

**1. Update protobufjs** (wajib, penjelasannya ada [di bawah](#wajib-pakai-protobufjs-terbaru)):

```bash
curl -fsSL https://raw.githubusercontent.com/andhikagg/waproto/main/fix.js | TARGET="baileys" node -
```

**2. Patch WAProto:**

```bash
curl -fsSL https://raw.githubusercontent.com/andhikagg/waproto/main/patch.js | TARGET="baileys" node -
```

`TARGET` adalah nama folder paket di dalam `node_modules`, contohnya:

```bash
TARGET="baileys"
TARGET="@whiskeysockets/baileys"
```

Biasanya kamu tidak perlu pairing ulang. Tapi kalau setelah patch muncul error koneksi
atau dekripsi, hapus folder auth/session Baileys lalu pairing lagi (scan QR code).

## Wajib: pakai protobufjs terbaru

`index.js` hasil build dikompilasi dengan `protobufjs-cli` terbaru dan mengimpor
`protobufjs/minimal`. Jadi runtime `protobufjs` yang dipakai Baileys juga harus cukup baru.
Kalau masih versi lama, bisa muncul masalah seperti method tidak ketemu, gagal decode,
atau error import.

`fix.js` mengurusnya lewat empat langkah:

1. Tidak menyentuh `package-lock.json` (kalau mau dihapus, pakai `RESET_LOCK=1`).
2. Mengubah `node_modules/<TARGET>/package.json` supaya `protobufjs` memakai versi yang
   kamu mau (default `latest`). File aslinya disimpan sekali sebagai `package.json.bak`.
3. Menjalankan `npm install protobufjs@<versi>` di root proyek.
4. Menyalin `node_modules/protobufjs` ke `node_modules/<TARGET>/node_modules/protobufjs`
   (dilewati kalau salinan di situ sudah versi yang sama).

Yang disalin hanya folder `protobufjs`. Dependensinya (`long`, `@protobufjs/*`) diambil
dari root proyek, tempat langkah 3 memasangnya. Kalau ada yang tidak ketemu, skrip akan
memberi peringatan.

| Variabel | Default | Keterangan |
| --- | --- | --- |
| `TARGET` | `baileys` | Nama paket di `node_modules`. Jalankan dari root proyek. |
| `SKIP_INSTALL` | tidak diset | Isi `1` untuk melewati `npm install` (kalau protobufjs sudah terpasang di root proyek). |
| `PROTOBUFJS_VERSION` | `latest` | Versi atau rentang versi protobufjs, misalnya `^7`. Berguna supaya tidak kaget kalau ada rilis mayor baru. |
| `RESET_LOCK` | tidak diset | Isi `1` untuk menghapus `package-lock.json` di root proyek. |

Untuk cek versi yang sebenarnya terpakai:

```bash
npm ls protobufjs
node -e "console.log(require('protobufjs/package.json').version)"
```

Setiap kali kamu menjalankan `npm install` atau `npm ci`, `node_modules` dibangun ulang
dan modul hasil salinan ikut hilang. Jalankan `fix.js` lagi setelahnya, atau masukkan
kedua skrip ke `postinstall` di `package.json`-mu:

```json
{
  "scripts": {
    "postinstall": "curl -fsSL https://raw.githubusercontent.com/andhikagg/waproto/main/fix.js | TARGET=baileys SKIP_INSTALL=1 node - && curl -fsSL https://raw.githubusercontent.com/andhikagg/waproto/main/patch.js | TARGET=baileys node -"
  }
}
```

`SKIP_INSTALL=1` dipakai di situ supaya skrip tidak memanggil `npm install` di tengah
proses install. Pastikan `protobufjs` sudah ada di dependensi proyekmu. Kedua skrip
aman dijalankan berkali-kali.

## Opsi patcher (`patch.js`)

| Variabel | Default | Keterangan |
| --- | --- | --- |
| `TARGET` | `baileys` | Nama paket di `node_modules` (dicari naik ke folder induk dari folder saat ini). |
| `SOURCE` | `https://raw.githubusercontent.com/andhikagg/waproto/main/WAProto` | URL dasar tempat `index.js`, `index.d.ts`, dan `WAProto.proto` diambil. Harus `https://`. |
| `DRY_RUN` | tidak diset | Isi `1` untuk hanya mengunduh dan memvalidasi, tanpa menulis apa pun. |

Yang dilakukan `patch.js`:

- Mengunduh semuanya ke memori dulu. File yang kosong atau terlalu kecil ditolak, dan
  sintaks `index.js` dicek sebelum `node_modules` disentuh.
- Kalau `protobufjs`-mu tidak punya `exports` map, menambahkan `.js` di import
  `protobufjs/minimal` supaya bisa dibaca Node ESM.
- Kalau `index.d.ts` masih memakai namespace `waproto`, otomatis diganti jadi `proto`.
- Hanya menulis file yang memang berubah, dan setiap file yang diganti dicadangkan
  sebagai `*.bak` di folder yang sama.
- Menulis lewat file sementara, dan otomatis rollback kalau ada penulisan yang gagal.
- Tidak melakukan apa-apa kalau semuanya sudah sama persis.
- Memberi peringatan kalau format modul (ESM vs CommonJS) file lama dan baru berbeda.

Butuh Node.js 18 atau lebih baru.

## Struktur repo

```
.
├── .github/workflows/update-waproto.yml   # cek upstream tiap jam + build
├── update.sh                              # unduh, kompilasi, patch, zip
├── fix.js                                 # update protobufjs di node_modules/<TARGET>
├── patch.js                               # pasang hasil build ke node_modules
├── WAProto/
│   ├── index.js
│   ├── index.d.ts
│   └── WAProto.proto
├── .waproto-sha                           # commit upstream terakhir yang sudah di-build
├── README.md
└── README-id.md
```

## Menyiapkan workflow

1. Taruh `update.sh` di root repo, dan file workflow di
   `.github/workflows/update-waproto.yml` pada branch default.
2. Buka **Settings → Actions → General → Workflow permissions**, lalu pilih
   **Read and write permissions**. Tanpa ini, langkah commit akan gagal.
3. Buka tab **Actions**, pilih **update-waproto**, lalu klik **Run workflow**
   (aktifkan `force` untuk run pertama) supaya tidak perlu menunggu jadwal.

Workflow terjadwal kadang telat beberapa menit. GitHub juga bisa menonaktifkannya kalau
repo tidak ada aktivitas selama 60 hari, dan workflow ini hanya commit saat upstream
berubah, jadi jangan berharap ia menjaga dirinya tetap aktif. Kalau sampai nonaktif,
nyalakan lagi dari tab Actions.

## Build manual

```bash
OUT_DIR=WAProto ZIP_NAME=waproto-build.zip bash update.sh
```

Kalau `pbjs` dan `pbts` belum ada di `./node_modules/.bin`, skrip memasang
`protobufjs-cli` ke folder sementara, jadi `package.json` dan `node_modules`-mu
tidak berubah.

| Variabel | Default | Keterangan |
| --- | --- | --- |
| `OUT_DIR` | `./` | Tempat `index.js`, `index.d.ts`, `WAProto.proto`, dan zip ditulis. |
| `ZIP_NAME` | `waproto-build.zip` | Nama file zip hasil build. |
| `PROTO_URL` | wa-proto `main` | Sumber `.proto`. Bisa dikunci ke satu commit, atau pakai path `file://`. |
| `MODULE_FORMAT` | `es6` | Format output `pbjs`: `es6` atau `commonjs`. |

Skrip memakai `zip` kalau ada, dan beralih ke `python3` kalau tidak.

## Catatan

- Build memakai output ES module (`pbjs -w es6`). Versi Baileys yang kamu pakai juga harus
  ES module, kalau tidak, build dengan `MODULE_FORMAT=commonjs`.
- Perubahan di upstream bisa menghapus atau mengganti nama tipe pesan. Cek dulu diff-nya
  sebelum dipakai di produksi.
- Untuk rollback WAProto, salin file `*.bak` menimpa file aslinya di
  `node_modules/<paket>/WAProto`, atau pasang ulang paketnya.
- Workflow memasang `protobufjs` dan `protobufjs-cli` tanpa mengunci versi, jadi rilis
  baru bisa mengubah hasil build.
- Menjalankan skrip dari `curl` langsung ke `node` berarti skrip itu jalan dengan izinmu.
  Pakai hanya URL dari repo yang kamu kelola atau sudah kamu baca isinya. Biar tidak
  kena dampak commit baru, ganti `main` di URL (dan di `SOURCE`) dengan hash commit tertentu.

## Pemecahan masalah

| Masalah | Solusi |
| --- | --- |
| Workflow tidak muncul di tab Actions | Pastikan path-nya persis `.github/workflows/update-waproto.yml`, ada di branch default, dan indentasi YAML-nya benar. |
| `git push` ditolak di workflow | Aktifkan **Read and write permissions** (lihat di atas). |
| Workflow gagal dengan `Invalid upstream SHA` | API GitHub mengembalikan error atau kena rate limit. Coba jalankan lagi nanti. |
| `"x" not found in .../node_modules` atau `package "x" not found` | Jalankan perintah dari root proyek dan cek lagi nama `TARGET`. |
| `SOURCE must be https://` | Pakai URL `https://`. `http://localhost` hanya boleh untuk pengujian. |
| Error decode atau error import `protobufjs/minimal` | Jalankan `fix.js`, lalu cek `npm ls protobufjs` kalau-kalau ada salinan bersarang yang lebih lama. |
| Error import setelah patch | Format modul tidak cocok. Build ulang dengan `MODULE_FORMAT` yang sesuai. |
| Error tipe soal `proto` atau `waproto` | Jalankan `patch.js` lagi, skrip ini mengganti `waproto` jadi `proto` di `index.d.ts`. |
| Perbaikan hilang setelah `npm install` | `node_modules` dibangun ulang. Jalankan `fix.js` dan `patch.js` lagi, atau pakai contoh `postinstall`. |
| WhatsApp terputus atau error setelah patch | Hapus folder auth/session lalu pairing ulang. |
