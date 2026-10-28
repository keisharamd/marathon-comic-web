import "fake-indexeddb/auto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { comicCache, evictOldChapters, MAX_CACHED_CHAPTERS, type CachedChapter } from "../client/src/lib/cache";
import { downloadChapterSequentially } from "../client/src/lib/loader";

const makeChapter = (key: string, urls: string[]): Omit<CachedChapter, "status" | "downloaded" | "updatedAt"> =>
  ({ key, sourceUrl: key, title: key, imageUrls: urls, total: urls.length });

beforeEach(async () => { await comicCache.delete(); comicCache.open(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("sequential chapter loader", () => {
  it("persists image one before starting the request for image two", async () => {
    let calls = 0;
    const events: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async () => {
      calls++;
      if (calls === 2) {
        const count = await comicCache.pages.where("chapterKey").equals("https://komiku.org/c").count();
        events.push("second-request-after-" + count + "-saved");
      } else events.push("first-request");
      return new Response(new Blob(["img"], { type: "image/jpeg" }), { status: 200, headers: { "content-type": "image/jpeg" } });
    }));
    const result = await downloadChapterSequentially(makeChapter("https://komiku.org/c", [
      "https://img.komiku.org/1.jpg", "https://img.komiku.org/2.jpg",
    ]));
    expect(result.status).toBe("complete");
    expect(events).toEqual(["first-request", "second-request-after-1-saved"]);
    expect(await comicCache.pages.where("chapterKey").equals(result.key).count()).toBe(2);
  });

  it("shares an in-flight sequence for the same chapter between reader and prefetch", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      calls++;
      await new Promise(resolve => setTimeout(resolve, 25));
      return new Response(new Blob(["img"], { type: "image/jpeg" }), { status: 200, headers: { "content-type": "image/jpeg" } });
    }));
    const input = makeChapter("https://komiku.org/shared", ["https://img.komiku.org/1.jpg"]);
    const firstProgress: string[] = [];
    const secondProgress: string[] = [];
    const first = downloadChapterSequentially(input, item => firstProgress.push(item.status + ":" + item.downloaded));
    const second = downloadChapterSequentially(input, item => secondProgress.push(item.status + ":" + item.downloaded));
    const [a, b] = await Promise.all([first, second]);
    expect(a.status).toBe("complete");
    expect(b.status).toBe("complete");
    expect(calls).toBe(1);
    expect(firstProgress.some(value => value.startsWith("downloading:"))).toBe(true);
    expect(secondProgress.some(value => value.startsWith("downloading:"))).toBe(true);
  });

  it("retries failed images and marks a chapter error when retries are exhausted", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      calls++;
      return new Response("bad", { status: 500, headers: { "content-type": "text/plain" } });
    }));
    await expect(downloadChapterSequentially(makeChapter("https://komiku.org/fail", ["https://img.komiku.org/1.jpg"])))
      .rejects.toThrow("gagal setelah 3 percobaan");
    expect(calls).toBe(3);
    expect((await comicCache.chapters.get("https://komiku.org/fail"))?.status).toBe("error");
  });

  it("evicts least-recently-used chapters but never the active chapter", async () => {
    for (let i = 0; i < 12; i++) {
      await comicCache.chapters.put({ key: "c" + i, sourceUrl: "https://komiku.org/" + i, title: "c" + i,
        imageUrls: [], status: "complete", downloaded: 0, total: 0, updatedAt: i });
    }
    await evictOldChapters("c0");
    const keys = (await comicCache.chapters.toArray()).map(chapter => chapter.key);
    expect(keys).toHaveLength(MAX_CACHED_CHAPTERS);
    expect(keys).toContain("c0");
    expect(keys).not.toContain("c1");
    expect(keys).toContain("c11");
  });
});
