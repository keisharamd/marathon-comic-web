export interface ChapterData{sourceUrl:string;title:string;imageUrls:string[];nextChapterUrl:string|null}
export interface ChapterExtractor{id:string;supports(url:URL):boolean;extract(url:URL,html:string):ChapterData}
