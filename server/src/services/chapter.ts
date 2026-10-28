import {safeFetch,readLimited} from "../security/fetch";
import {parseSourceUrl} from "../security/url";
import {komikuExtractor} from "../extractors/komiku";
import type {ChapterData} from "../extractors/types";
export async function getChapter(raw:unknown):Promise<ChapterData>{
 const url=parseSourceUrl(raw);if(!komikuExtractor.supports(url))throw new Error("Belum ada extractor untuk domain ini.");
 const response=await safeFetch(url,{headers:{accept:"text/html,application/xhtml+xml"}});
 if(!response.ok)throw new Error(`Sumber mengembalikan HTTP ${response.status}.`);
 const type=response.headers.get("content-type")??"";if(!type.includes("text/html")&&!type.includes("application/xhtml+xml"))throw new Error("Sumber bukan halaman HTML.");
 const html=new TextDecoder().decode(await readLimited(response,Number(process.env.MAX_HTML_BYTES??3000000)));
 const chapter=komikuExtractor.extract(url,html);if(!chapter.imageUrls.length)throw new Error("Gambar chapter tidak terdeteksi; struktur situs mungkin berubah atau membutuhkan JavaScript.");
 chapter.imageUrls=chapter.imageUrls.slice(0,Number(process.env.MAX_IMAGES_PER_CHAPTER??300));
 try{const next=chapter.nextChapterUrl?parseSourceUrl(chapter.nextChapterUrl):null;chapter.nextChapterUrl=next&&komikuExtractor.supports(next)?next.toString():null}catch{chapter.nextChapterUrl=null}
 return chapter;
}
