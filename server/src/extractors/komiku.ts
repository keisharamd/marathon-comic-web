import * as cheerio from "cheerio";
import type { ChapterData, ChapterExtractor } from "./types";

function resolve(raw: string | undefined, base: URL): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw, base);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch { return null; }
}

export const komikuExtractor: ChapterExtractor = {
  id: "komiku",
  supports(url) { return /(^|\.)komiku\.(org|cc|net|to|site|online)$/i.test(url.hostname); },
  extract(url, html): ChapterData {
    const $ = cheerio.load(html);
    const title = $("h1").first().text().trim() || $("title").text().trim() || "Chapter komik";
    // The live Komiku chapter inspected uses #Baca_Komik; retain alternatives for theme changes.
    const selectors = ["#Baca_Komik img", "#Baca_Online img", ".chapter-content img", ".reading-content img", ".readerarea img", ".reading-detail img", ".entry-content img", "article img", "main img"];
    let nodes = $(selectors[0]);
    for (const selector of selectors) { const found = $(selector); if (found.length > nodes.length) nodes = found; }
    const imageUrls: string[] = [];
    nodes.each((_, element) => {
      const image = $(element);
      const raw = image.attr("data-src") || image.attr("data-lazy-src") || image.attr("data-original") || image.attr("src") ||
        image.attr("srcset")?.split(",")[0]?.trim().split(/\s+/)[0];
      const source = resolve(raw, url);
      if (!source) return;
      const parsed = new URL(source);
      if (/(promosi|banner|logo|avatar|thumbnail|icon)/i.test(parsed.pathname + " " + (image.attr("alt") ?? ""))) return;
      if (!/\.(jpe?g|png|webp|gif|avif)(?:$|\?)/i.test(parsed.pathname + parsed.search) &&
          !/(upload|chapter|comic|manga|image|img|cdn)/i.test(parsed.hostname + parsed.pathname)) return;
      if (!imageUrls.includes(source)) imageUrls.push(source);
    });
    let nextChapterUrl: string | null = null;
    for (const selector of ["a[rel='next']", "a.next", ".next a", "a:contains('Chapter Selanjutnya')", "a:contains('Next Chapter')", "a:contains('Selanjutnya')"]) {
      const candidate = resolve($(selector).first().attr("href"), url);
      if (candidate && candidate !== url.toString()) { nextChapterUrl = candidate; break; }
    }
    if (!nextChapterUrl) $("a").each((_, element) => {
      if (nextChapterUrl) return;
      const anchor = $(element);
      const label = [anchor.text(), anchor.attr("aria-label"), anchor.attr("title"), anchor.attr("rel")].join(" ").toLowerCase();
      if (/next|selanjutnya|berikutnya|chapter berikut/.test(label)) {
        const candidate = resolve(anchor.attr("href"), url);
        if (candidate && candidate !== url.toString()) nextChapterUrl = candidate;
      }
    });
    return { sourceUrl: url.toString(), title, imageUrls, nextChapterUrl };
  },
};
