# marathon-comic-web

Pembaca web comic ringan: React + Vite + TypeScript + Tailwind CSS dengan komponen Button bergaya shadcn/ui di frontend dan Hono/Node.js di backend. HTML sumber diambil dengan native `fetch` lalu diparse menggunakan Cheerio. Blob gambar disimpan di IndexedDB via Dexie. Tidak ada Playwright, Puppeteer, Chromium, database server, Redis, atau layanan berbayar.

## Instalasi

Persyaratan: Node.js 20.19+ dan npm.

```sh
npm install
# salin .env.example ke .env bila ingin mengubah konfigurasi
npm run dev
```

Frontend: http://localhost:5173 · API health: http://localhost:8787/api/health

## Perintah npm

- `npm run dev` — jalankan API dan frontend bersamaan.
- `npm run dev:client` / `npm run dev:server` — jalankan satu bagian saja.
- `npm run build` — build frontend dan backend secara independen.
- `npm start` — jalankan backend hasil build.
- `npm run typecheck` — TypeScript check frontend dan backend.
- `npm test` — Vitest.

## API

- `GET /api/chapter?url=<encoded-url>` — judul, daftar URL gambar dalam urutan sumber, dan URL next.
- `GET /api/next?url=<encoded-url>` — URL next hasil ekstraksi dan validasi.
- `GET /api/image?url=<encoded-image-url>` — proxy gambar terbatas.
- `GET /api/prefetch/events?url=<encoded-url>` — SSE: status ekstraksi, hasil chapter, next, prefetch-ready, done, atau error.
- `GET /api/health` — health check.

## Konfigurasi

Salin `.env.example` ke `.env` jika diperlukan. Variabel: `HOST`, `PORT`, `SOURCE_HOSTS`, `FETCH_TIMEOUT_MS`, `MAX_HTML_BYTES`, `MAX_IMAGE_BYTES`, `MAX_IMAGES_PER_CHAPTER`, `MAX_REDIRECTS`. `SOURCE_HOSTS` adalah daftar hostname tambahan yang ditinjau manual. Jangan menyimpan secret di frontend.

## Sequential loading dan cache

Di dalam chapter aktif, setiap gambar di-fetch, divalidasi sebagai image Blob, lalu ditulis ke IndexedDB sebelum request gambar berikutnya dimulai. Retry dibatasi tiga kali; jika gagal, status chapter menjadi `error`, bukan `complete`. Status metadata: `pending`, `downloading`, `complete`, `error`. Metadata hanya menjadi complete jika semua Blob tercatat di transaksi IndexedDB.

Setelah chapter aktif lengkap, SSE mendeteksi next. Jika URL next ditemukan dan valid, aplikasi mem-prefetch hingga lima chapter berikutnya secara sequential. Cache mempertahankan maksimal 10 chapter dengan eviction LRU dan mengecualikan chapter aktif. Estimasi kuota diperiksa jika API Storage tersedia; `QuotaExceededError` ditangani dengan pesan jelas. Prefetch tidak dijamin berjalan setelah tab ditutup atau ditangguhkan.

## Extractor Komiku: asumsi dan batasan

Adapter awal menggunakan kandidat selector umum `#Baca_Komik img`, `.chapter-content img`, `.reading-content img`, `.readerarea img`, `.reading-detail img`, `.entry-content img`, dan container umum. Struktur HTML Komiku dapat berbeda antar-domain/tema; selector perlu disesuaikan jika sumber berubah. Situs yang memerlukan JavaScript untuk merender gambar, autentikasi, atau CAPTCHA tidak diakali dan dapat menghasilkan error ekstraksi.

Default allowlist: `komiku.org`, `komiku.cc`, `komiku.net`, `komiku.to`, `komiku.site`, `komiku.online` dan subdomainnya. Host CDN lain harus ditambahkan secara eksplisit setelah ditinjau. Pastikan penggunaan konten mematuhi kebijakan sumber dan hak pemiliknya.

## Keamanan proxy

Proxy ini bukan open proxy: URL harus menggunakan HTTP/HTTPS, hostname allowlist, dan port standar. Kredensial URL ditolak; redirect diperiksa ulang per-hop; resolusi DNS yang mengarah ke alamat privat/khusus diblokir. Ukuran respons, timeout, redirect, jumlah gambar, dan MIME type gambar dibatasi. Proteksi sumber tidak dinonaktifkan.

Catatan teknis: validasi DNS dilakukan sebelum request, tetapi fetch Node.js melakukan resolusi koneksi sendiri; untuk deployment berisiko tinggi, tambahkan egress firewall atau transport yang mengikat koneksi ke alamat IP hasil validasi untuk mitigasi DNS rebinding.

## Deployment

Untuk Node.js standar: jalankan `npm run build`, deploy `dist-server/` beserta production dependencies, jalankan `npm start` dengan `HOST` dan `PORT`, dan host `dist-client/` pada static hosting terpisah. Atur reverse proxy `/api` ke backend dan fallback SPA ke `index.html`.

Wasmer Edge docs menjelaskan HTTP server proxy mode berbasis WebAssembly/WASIX dan instance aplikasi bersifat stateless/ephemeral. Auto-detection JavaScript tidak dengan sendirinya membuktikan bahwa backend Node.js/Hono ini cocok pada runtime target. Belum ada `app.yaml` atau klaim kompatibilitas Wasmer: verifikasi target/runtime dan lakukan build + deployment smoke test dahulu. Referensi: [Wasmer Edge Apps](https://docs.wasmer.io/edge/learn/apps/), [Deployment modes](https://docs.wasmer.io/edge/learn/deployment-modes/), [Supported frameworks](https://docs.wasmer.io/edge/learn/supported-frameworks-and-languages/).
