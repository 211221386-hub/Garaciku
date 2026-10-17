# Garaciku

Aplikasi Expo untuk pencatatan mobil, servis, kerusakan, checklist kendaraan, dan alur rental.

## Arsitektur

- Aplikasi menggunakan Expo Router dan React Native, dengan target web dan native.
- Cloudflare Worker (`worker.js`) adalah backend resmi. Aplikasi mengirim autentikasi dan operasi data ke endpoint `/api/*` pada Worker.
- Supabase menyediakan PostgreSQL dan REST API. Worker menggunakan `service_role` di sisi server; key tersebut tidak boleh dimasukkan ke environment aplikasi.
- `server/` berisi Express API lama. API tersebut bukan backend untuk adapter aplikasi saat ini. Jangan gunakan `npm run server` atau `npm run dev:all` untuk menjalankan aplikasi utama.

## Prasyarat

- Node.js dan npm yang kompatibel dengan versi Expo pada `package.json`.
- Proyek Supabase untuk database.
- Akun Cloudflare dan Wrangler untuk menjalankan atau deploy Worker.

## Setup Lokal

1. Pasang dependency:

	```sh
	npm install
	```

2. Buat `.env.local` dari `.env.example`. Isi `EXPO_PUBLIC_API_BASE_URL` dengan origin Worker yang dapat dijangkau saat memakai Expo development server (termasuk web) atau aplikasi native. Untuk web yang langsung disajikan Worker pada origin yang sama, variabel ini boleh dikosongkan.

3. Untuk menjalankan Worker lokal, buat `.dev.vars` dari `.dev.vars.example`, lalu isi `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, dan `APP_JWT_SECRET`. Secret JWT harus memiliki sedikitnya 32 byte. `APP_ORIGIN` lokal pada contoh harus cocok dengan origin Wrangler, biasanya `http://localhost:8787`. `RENTAL_AUTOMATION_URL` hanya diperlukan untuk integrasi notifikasi.

4. Jalankan web melalui Worker lokal:

	```sh
	npm run build:web
	npx wrangler dev
	```

	Buka URL lokal yang ditampilkan Wrangler. Perintah build membuat direktori `dist` yang disajikan oleh konfigurasi assets Worker.

5. Untuk menjalankan Expo di perangkat atau emulator:

	```sh
	npm run dev
	```

	Pastikan `EXPO_PUBLIC_API_BASE_URL` menunjuk ke Worker yang dapat dijangkau perangkat, baik Worker lokal di jaringan yang sama maupun deployment development.

Jangan masukkan `SUPABASE_SERVICE_ROLE_KEY`, `APP_JWT_SECRET`, atau URL webhook ke variabel `EXPO_PUBLIC_*`. Nilai `EXPO_PUBLIC_*` ikut dibundel ke aplikasi.

## Database Supabase

Gunakan proyek staging terlebih dahulu dan buat backup sebelum mengubah database. Terapkan file di `supabase/migrations/` menurut urutan timestamp, satu kali per file. Ikuti [panduan keamanan Worker-only](supabase/WORKER_ONLY_SECURITY_SETUP.md) untuk urutan deployment: migrasi penguncian akses `20261015100000_lock_app_tables_to_worker.sql` dijalankan setelah Worker siap, karena migrasi tersebut mencabut akses tabel langsung dari role `anon` dan `authenticated`.

Migrasi awal menyertakan akun demo. Jangan memakai akun atau password demo untuk deployment produksi; siapkan kredensial produksi yang unik dan verifikasi login sebelum membuka aplikasi ke pengguna.

## Environment

### Aplikasi Expo

| Variabel | Kegunaan |
| --- | --- |
| `EXPO_PUBLIC_API_BASE_URL` | Origin Worker untuk aplikasi native. Untuk web pada origin Worker yang sama, aplikasi memakai origin browser bila variabel ini tidak diisi. |

### Cloudflare Worker

`SUPABASE_URL` dan `APP_ORIGIN` tersedia sebagai `vars` di `wrangler.jsonc`; pastikan nilainya cocok dengan proyek dan domain deployment Anda.

Konfigurasi Wrangler juga membatasi login menjadi 20 request per menit per IP dan 5 request per menit per username. Rate-limit binding Worker bersifat per lokasi Cloudflare dan eventually consistent; pertahankan aturan rate limiting WAF yang lebih luas untuk perlindungan lintas lokasi.

| Binding/secret | Wajib | Kegunaan |
| --- | --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | Ya | Akses database server-side. Atur sebagai Worker secret, bukan `vars` atau variabel Expo. |
| `APP_JWT_SECRET` | Ya | Menandatangani token sesi; minimal 32 byte. Atur sebagai Worker secret. |
| `RENTAL_AUTOMATION_URL` | Tidak | URL webhook notifikasi rental. Atur sebagai Worker secret jika integrasi digunakan. |

Atur secret deployment dengan Wrangler:

```sh
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put APP_JWT_SECRET
npx wrangler secret put RENTAL_AUTOMATION_URL
```

Jalankan perintah webhook hanya jika integrasi notifikasi digunakan. Wrangler akan meminta nilai secret secara interaktif.

## Perintah

| Perintah | Kegunaan |
| --- | --- |
| `npm run dev` | Menjalankan Expo development server. |
| `npm run build:web` | Membuat export web Expo ke `dist`. |
| `npx wrangler dev` | Menjalankan Worker lokal dan menyajikan `dist`. |
| `npm test` | Menjalankan tes Worker. |
| `npm run typecheck` | Memeriksa tipe TypeScript. |
| `npm run lint` | Menjalankan ESLint. |
| `npm run deploy` | Build web lalu deploy Worker dan assets ke Cloudflare. |

Untuk deploy, login ke Cloudflare dengan Wrangler, periksa `APP_ORIGIN` dan `SUPABASE_URL` di `wrangler.jsonc`, atur secrets yang diperlukan, lalu jalankan `npm run deploy`.