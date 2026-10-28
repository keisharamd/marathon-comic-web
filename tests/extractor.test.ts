import { describe, it, expect } from "vitest";
import { komikuExtractor } from "../server/src/extractors/komiku";

describe("Komiku extractor", () => {
  it("preserves DOM order, filters promotion images and resolves next chapter", () => {
    const url = new URL("https://komiku.org/example-chapter/");
    const html = '<h1>Example Chapter</h1><div id="Baca_Komik"><img src="https://img.komiku.org/komiku-promosi.webp" alt="Promosi"><img data-src="/uploads/1.jpg"><img src="https://img.komiku.org/2.jpg"></div><a class="next" href="/example-chapter-2/">Next</a>';
    const result = komikuExtractor.extract(url, html);
    expect(komikuExtractor.supports(url)).toBe(true);
    expect(result.title).toBe("Example Chapter");
    expect(result.imageUrls).toEqual(["https://komiku.org/uploads/1.jpg", "https://img.komiku.org/2.jpg"]);
    expect(result.nextChapterUrl).toBe("https://komiku.org/example-chapter-2/");
  });
});
