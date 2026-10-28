import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Info, X } from "lucide-react";
import { downloadChapterSequentially } from "./lib/loader";
import {
  comicCache,
  readCachedPages,
  type CachedPage,
  type ChapterStatus,
} from "./lib/cache";
import { Button } from "./components/ui/button";

type ChapterData = {
  sourceUrl: string;
  title: string;
  imageUrls: string[];
  nextChapterUrl: string | null;
};
const validUrl = (value: string) => {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};
const chapterApi = (url: string) =>
  "/api/chapter?url=" + encodeURIComponent(url);

export default function App() {
  const [sourceUrl, setSourceUrl] = useState(
    new URLSearchParams(location.search).get("url") ?? "",
  );
  const [chapter, setChapter] = useState<ChapterData | null>(null);
  const [pages, setPages] = useState<CachedPage[]>([]);
  const [status, setStatus] = useState<ChapterStatus | "idle">("idle");
  const [progress, setProgress] = useState({ downloaded: 0, total: 0 });
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [nextUrl, setNextUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [prefetching, setPrefetching] = useState(false);
  const [cachedCount, setCachedCount] = useState(0);
  const [autoPrefetchedFor, setAutoPrefetchedFor] = useState<string | null>(
    null,
  );
  const [readerToolbarVisible, setReaderToolbarVisible] = useState(true);
  const [readerToolbarMounted, setReaderToolbarMounted] = useState(true);
  const [infoOpen, setInfoOpen] = useState(false);
  const [infoMounted, setInfoMounted] = useState(false);
  const isReader = location.pathname === "/s";

  useEffect(() => {
    if (readerToolbarVisible) {
      setReaderToolbarMounted(true);
      return;
    }
    const timeout = window.setTimeout(
      () => setReaderToolbarMounted(false),
      440,
    );
    return () => window.clearTimeout(timeout);
  }, [readerToolbarVisible]);

  useEffect(() => {
    if (infoOpen) {
      setInfoMounted(true);
      return;
    }
    const timeout = window.setTimeout(() => setInfoMounted(false), 340);
    return () => window.clearTimeout(timeout);
  }, [infoOpen]);

  const refreshCacheCount = useCallback(
    async () => setCachedCount(await comicCache.chapters.count()),
    [],
  );
  const loadChapter = useCallback(
    async (url: string) => {
      setBusy(true);
      setError("");
      setMessage("");
      setChapter(null);
      setPages([]);
      setNextUrl(null);
      setStatus("pending");
      try {
        if (!validUrl(url))
          throw new Error("Masukkan URL chapter HTTP/HTTPS yang valid.");
        history.replaceState(null, "", "/s?url=" + encodeURIComponent(url));
        const response = await fetch(chapterApi(url));
        const data = (await response.json()) as ChapterData & {
          error?: string;
        };
        if (!response.ok)
          throw new Error(data.error || "Gagal mengambil chapter.");
        if (!data.imageUrls?.length)
          throw new Error("Daftar gambar chapter kosong.");
        setChapter(data);
        setSourceUrl(data.sourceUrl);
        setProgress({ downloaded: 0, total: data.imageUrls.length });
        let pageRefresh = Promise.resolve();
        let visibleDownloaded = 0;
        const complete = await downloadChapterSequentially(
          {
            key: data.sourceUrl,
            sourceUrl: data.sourceUrl,
            title: data.title,
            imageUrls: data.imageUrls,
            total: data.imageUrls.length,
          },
          (item) => {
            setStatus(item.status);
            setProgress({ downloaded: item.downloaded, total: item.total });
            if (item.error) setError(item.error);
            // Progress advances only after the image Blob is persisted in IndexedDB.
            // Serialize reads so an older snapshot cannot replace a newer one.
            if (item.downloaded > visibleDownloaded) {
              visibleDownloaded = item.downloaded;
              pageRefresh = pageRefresh.then(async () => {
                setPages(await readCachedPages(item.key));
              });
            }
          },
        );
        await pageRefresh;
        setStatus(complete.status);
        setPages(await readCachedPages(complete.key));
        await refreshCacheCount();
        setMessage("Chapter aktif selesai. Memeriksa chapter berikutnya…");
        // The SSE next lookup starts only after the active chapter is complete.
        const events = new EventSource(
          "/api/prefetch/events?url=" + encodeURIComponent(data.sourceUrl),
        );
        events.addEventListener("next", (event) => {
          const payload = JSON.parse((event as MessageEvent).data) as {
            status: string;
            url: string | null;
          };
          setNextUrl(payload.status === "found" ? payload.url : null);
          setMessage(
            payload.url
              ? "Chapter berikutnya terverifikasi."
              : "Chapter berikutnya tidak ditemukan.",
          );
        });
        events.addEventListener("error", (event) => {
          const detail = (event as MessageEvent).data;
          if (detail) {
            try {
              setError(JSON.parse(detail).message);
            } catch {
              setError("Koneksi SSE terputus.");
            }
          }
        });
        events.addEventListener("done", () => events.close());
      } catch (cause) {
        setStatus("error");
        setError(cause instanceof Error ? cause.message : "Terjadi kesalahan.");
      } finally {
        setBusy(false);
      }
    },
    [refreshCacheCount],
  );

  useEffect(() => {
    if (isReader && sourceUrl) void loadChapter(sourceUrl);
  }, []);
  useEffect(() => {
    void refreshCacheCount();
  }, [refreshCacheCount]);

  const prefetchNextChapters = useCallback(async () => {
    if (!nextUrl || status !== "complete" || prefetching || !chapter) return;
    setPrefetching(true);
    try {
      let url: string | null = nextUrl;
      for (let index = 0; index < 5 && url; index++) {
        const response = await fetch(chapterApi(url));
        const data = (await response.json()) as ChapterData & {
          error?: string;
        };
        if (!response.ok)
          throw new Error(data.error || "Gagal mengekstrak chapter prefetch.");
        await downloadChapterSequentially(
          {
            key: data.sourceUrl,
            sourceUrl: data.sourceUrl,
            title: data.title,
            imageUrls: data.imageUrls,
            total: data.imageUrls.length,
          },
          (item) =>
            setMessage(
              "Prefetch " +
                (index + 1) +
                "/5: " +
                item.downloaded +
                "/" +
                item.total +
                " gambar",
            ),
        );
        url = data.nextChapterUrl;
        await refreshCacheCount();
      }
      setMessage("Prefetch selesai.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Prefetch gagal.");
    } finally {
      setPrefetching(false);
    }
  }, [nextUrl, status, prefetching, chapter, refreshCacheCount]);

  // Prefetch starts automatically once the current chapter is complete and its next URL is verified.
  useEffect(() => {
    if (
      nextUrl &&
      status === "complete" &&
      chapter &&
      autoPrefetchedFor !== chapter.sourceUrl
    ) {
      setAutoPrefetchedFor(chapter.sourceUrl);
      void prefetchNextChapters();
    }
  }, [nextUrl, status, chapter, autoPrefetchedFor, prefetchNextChapters]);

  const goNext = () => {
    if (!nextUrl || busy) return;
    history.pushState(null, "", "/s?url=" + encodeURIComponent(nextUrl));
    void loadChapter(nextUrl);
  };

  return (
    <div className="shell">
      {!isReader && (
        <header>
          <a className="brand" href="/">
            <b>M</b> marathon<span>comic</span>
          </a>
          <div className="meta">
            <i /> Local-first reader <small>{cachedCount}/10 cache</small>
          </div>
        </header>
      )}
      {!isReader ? (
        <main className="home">
          <div className="eyebrow">LIGHTWEIGHT COMIC READER</div>
          <h1>
            Baca tanpa
            <br />
            <span>kehilangan alur.</span>
          </h1>
          <p className="lead">
            Masukkan URL chapter Komiku. Gambar dimuat satu per satu dan
            disimpan lokal untuk menghemat bandwidth.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!validUrl(sourceUrl)) {
                setError("URL HTTP/HTTPS tidak valid.");
                return;
              }
              history.pushState(
                null,
                "",
                "/s?url=" + encodeURIComponent(sourceUrl),
              );
              void loadChapter(sourceUrl);
            }}
          >
            <label htmlFor="source-url">URL chapter</label>
            <div className="inputrow">
              <input
                id="source-url"
                type="url"
                required
                value={sourceUrl}
                onChange={(event) => setSourceUrl(event.target.value)}
                placeholder="https://komiku.org/..."
              />
              <Button type="submit" disabled={busy}>
                {busy ? "Memuat…" : "Baca chapter ↗"}
              </Button>
            </div>
          </form>
          {error && (
            <ErrorBox text={error} retry={() => void loadChapter(sourceUrl)} />
          )}
          <div className="features">
            <Feature
              n="01"
              title="Sequential loading"
              text="Setiap gambar tersimpan sebelum request berikutnya dimulai."
            />
            <Feature
              n="02"
              title="Cache lokal"
              text="Blob tersimpan di IndexedDB, maksimal 10 chapter."
            />
            <Feature
              n="03"
              title="Proxy terbatas"
              text="Host, redirect, ukuran respons, dan tipe konten divalidasi."
            />
          </div>
          <p className="fine">
            Sumber yang membutuhkan JavaScript, login, atau CAPTCHA tidak
            diakali dan mungkin tidak dapat diekstrak.
          </p>
        </main>
      ) : (
        <main className="reader">
          {readerToolbarMounted && (
            <div
              className={`reader-toolbar reader-toolbar-top ${readerToolbarVisible ? "is-visible" : "is-hidden"}`}
              aria-hidden={!readerToolbarVisible}
            >
              <a
                className="reader-icon-button"
                href="/"
                aria-label="Kembali ke beranda"
                tabIndex={readerToolbarVisible ? 0 : -1}
              >
                <ArrowLeft aria-hidden="true" />
              </a>
              <div className="reader-chapter">
                <strong>{chapter?.title || "Menyiapkan chapter…"}</strong>
                <span>
                  {chapter
                    ? "Halaman " +
                      Math.min(pages.length, progress.total) +
                      "/" +
                      progress.total
                    : "Menyiapkan reader…"}
                </span>
              </div>
              <button
                className="reader-icon-button"
                aria-label="Informasi chapter"
                title="Informasi chapter"
                onClick={() => setInfoOpen(true)}
                tabIndex={readerToolbarVisible ? 0 : -1}
              >
                <Info aria-hidden="true" />
              </button>
            </div>
          )}

          {busy && pages.length === 0 && (
            <p className="reader-loading">Mengambil gambar pertama…</p>
          )}
          {pages.length > 0 && (
            <div
              className="pages"
              onClick={() => {
                if (!infoOpen) setReaderToolbarVisible((visible) => !visible);
              }}
              aria-label="Ketuk gambar untuk menampilkan atau menyembunyikan toolbar"
            >
              {pages.map((page) => (
                <CachedPageImage key={page.id ?? page.index} page={page} />
              ))}
            </div>
          )}
          {error && pages.length === 0 && (
            <div className="reader-error">
              <ErrorBox
                text={error}
                retry={() => void loadChapter(sourceUrl)}
              />
            </div>
          )}

          {readerToolbarMounted && (
            <div
              className={`reader-toolbar reader-toolbar-bottom ${readerToolbarVisible ? "is-visible" : "is-hidden"}`}
              aria-hidden={!readerToolbarVisible}
            >
              <button
                className="next-chapter"
                disabled={!nextUrl || busy}
                onClick={goNext}
                tabIndex={readerToolbarVisible ? 0 : -1}
              >
                {busy ? "Memuat…" : "Chapter berikutnya"}
                <ArrowRight className="next-chapter-icon" aria-hidden="true" />
              </button>
            </div>
          )}

          {infoMounted && (
            <div
              className={`info-backdrop ${infoOpen ? "is-open" : "is-closing"}`}
              role="presentation"
            >
              <section
                className={`info-modal ${infoOpen ? "is-open" : "is-closing"}`}
                role="dialog"
                aria-modal="true"
                aria-labelledby="reader-info-title"
              >
                <div className="info-modal-heading">
                  <div>
                    <div className="eyebrow">READER DETAILS</div>
                    <h2 id="reader-info-title">Info chapter</h2>
                  </div>
                  <button
                    className="reader-icon-button"
                    aria-label="Tutup info"
                    onClick={() => setInfoOpen(false)}
                  >
                    <X aria-hidden="true" />
                  </button>
                </div>
                <dl className="info-list">
                  <div>
                    <dt>Judul</dt>
                    <dd>{chapter?.title || "Belum tersedia"}</dd>
                  </div>
                  <div>
                    <dt>Status chapter</dt>
                    <dd>{status}</dd>
                  </div>
                  <div>
                    <dt>Gambar tersimpan</dt>
                    <dd>
                      {progress.downloaded}/{progress.total}
                    </dd>
                  </div>
                  <div>
                    <dt>Cache lokal</dt>
                    <dd>{cachedCount}/10 chapter</dd>
                  </div>
                  <div>
                    <dt>Prefetch berikutnya</dt>
                    <dd>
                      {prefetching
                        ? "Sedang berjalan"
                        : nextUrl
                          ? "URL chapter berikutnya ditemukan"
                          : "Belum tersedia"}
                    </dd>
                  </div>
                  <div>
                    <dt>Prefetch otomatis</dt>
                    <dd>Maksimal 5 chapter saat tab aktif</dd>
                  </div>
                  <div>
                    <dt>Sumber</dt>
                    <dd className="info-url">
                      {chapter?.sourceUrl || sourceUrl || "Belum tersedia"}
                    </dd>
                  </div>
                  {message && (
                    <div>
                      <dt>Aktivitas terakhir</dt>
                      <dd>{message}</dd>
                    </div>
                  )}
                  {error && (
                    <div>
                      <dt>Error</dt>
                      <dd className="info-error">{error}</dd>
                    </div>
                  )}
                </dl>
                <div className="info-actions">
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => void loadChapter(sourceUrl)}
                  >
                    Muat ulang
                  </button>
                  <button
                    className="secondary"
                    disabled={!nextUrl || prefetching}
                    onClick={() => void prefetchNextChapters()}
                  >
                    {prefetching ? "Prefetch berjalan…" : "Prefetch 5 chapter"}
                  </button>
                </div>
              </section>
            </div>
          )}
        </main>
      )}
      {!isReader && (
        <footer>
          <span>MARATHON COMIC</span>
          <span>Cache-first · Sequential by design</span>
        </footer>
      )}
    </div>
  );
}
function CachedPageImage({ page }: { page: CachedPage }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    const objectUrl = URL.createObjectURL(page.blob);
    setSrc(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [page.blob]);
  return src ? (
    <img
      src={src}
      alt={"Halaman " + (page.index + 1)}
      loading={page.index < 2 ? "eager" : "lazy"}
    />
  ) : null;
}

function Feature({
  n,
  title,
  text,
}: {
  n: string;
  title: string;
  text: string;
}) {
  return (
    <article>
      <small>{n}</small>
      <h3>{title}</h3>
      <p>{text}</p>
    </article>
  );
}
function ErrorBox({ text, retry }: { text: string; retry: () => void }) {
  return (
    <div className="error" role="alert">
      <div>
        <b>Gagal memuat</b>
        <p>{text}</p>
      </div>
      <button className="secondary" onClick={retry}>
        Coba lagi
      </button>
    </div>
  );
}
