import {
  comicCache,
  type CachedChapter,
  markChapter,
  savePageInOrder,
  completeChapter,
  evictOldChapters,
  checkStorageQuota,
} from "./cache";

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 400;
export type LoaderProgress = (chapter: CachedChapter) => void;
type Flight = { promise: Promise<CachedChapter>; subscribers: Set<LoaderProgress> };
const inFlight = new Map<string, Flight>();
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchImage(sourceUrl: string): Promise<Blob> {
  const response = await fetch("/api/image?url=" + encodeURIComponent(sourceUrl));
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || "HTTP " + response.status + " saat mengambil gambar.");
  }
  const blob = await response.blob();
  if (!blob.size || !blob.type.startsWith("image/")) throw new Error("Respons bukan gambar valid.");
  return blob;
}

/** Single-flight prevents active reading and prefetch from duplicating a chapter sequence. */
export function downloadChapterSequentially(
  input: Omit<CachedChapter, "status" | "downloaded" | "updatedAt">,
  onProgress: LoaderProgress = () => {},
): Promise<CachedChapter> {
  const current = inFlight.get(input.key);
  if (current) {
    current.subscribers.add(onProgress);
    return current.promise.finally(() => current.subscribers.delete(onProgress));
  }
  const subscribers = new Set<LoaderProgress>([onProgress]);
  const promise = downloadChapterInternal(input, chapter => {
    subscribers.forEach(subscriber => subscriber(chapter));
  }).finally(() => inFlight.delete(input.key));
  inFlight.set(input.key, { promise, subscribers });
  return promise;
}

async function downloadChapterInternal(
  input: Omit<CachedChapter, "status" | "downloaded" | "updatedAt">,
  onProgress: LoaderProgress,
): Promise<CachedChapter> {
  const old = await comicCache.chapters.get(input.key);
  if (old?.status === "complete" && old.downloaded === input.imageUrls.length &&
      await comicCache.pages.where("chapterKey").equals(input.key).count() === input.imageUrls.length) {
    onProgress(old);
    return old;
  }

  let chapter: CachedChapter = { ...input, status: "pending", downloaded: 0, total: input.imageUrls.length, updatedAt: Date.now() };
  await comicCache.transaction("rw", comicCache.chapters, comicCache.pages, async () => {
    await comicCache.pages.where("chapterKey").equals(chapter.key).delete();
    await comicCache.chapters.put(chapter);
  });
  onProgress(chapter);

  const quota = await checkStorageQuota();
  if (quota.usage !== undefined && quota.quota !== undefined && quota.quota > 0 && quota.usage / quota.quota >= 0.98) {
    chapter = { ...chapter, status: "error", error: "Kuota penyimpanan browser hampir habis. Hapus cache atau kosongkan ruang.", updatedAt: Date.now() };
    await markChapter(chapter, "error", chapter.error);
    onProgress(chapter);
    throw new Error(chapter.error);
  }

  chapter = { ...chapter, status: "downloading", updatedAt: Date.now() };
  await comicCache.chapters.put(chapter);
  onProgress(chapter);

  try {
    for (let index = 0; index < chapter.imageUrls.length; index++) {
      let blob: Blob | undefined;
      let lastError: unknown;
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try { blob = await fetchImage(chapter.imageUrls[index]); break; }
        catch (error) {
          lastError = error;
          if (attempt < MAX_RETRIES) await wait(RETRY_DELAY_MS * attempt);
        }
      }
      if (!blob) {
        throw new Error("Gambar " + (index + 1) + " gagal setelah " + MAX_RETRIES +
          " percobaan: " + (lastError instanceof Error ? lastError.message : "error tidak diketahui"));
      }
      try {
        // Persist before the next loop iteration/request.
        await savePageInOrder(chapter, index, chapter.imageUrls[index], blob);
      } catch (error) {
        if (error instanceof DOMException && error.name === "QuotaExceededError") {
          throw new Error("Kuota penyimpanan browser penuh; kosongkan ruang lalu coba lagi.");
        }
        throw error;
      }
      chapter = { ...chapter, downloaded: index + 1, updatedAt: Date.now() };
      onProgress(chapter);
    }
    await completeChapter(chapter);
    chapter = { ...chapter, status: "complete", downloaded: chapter.total, updatedAt: Date.now() };
    await evictOldChapters(chapter.key);
    onProgress(chapter);
    return chapter;
  } catch (error) {
    chapter = { ...chapter, status: "error", error: error instanceof Error ? error.message : "Download gagal.", updatedAt: Date.now() };
    await markChapter(chapter, "error", chapter.error);
    onProgress(chapter);
    throw error;
  }
}
