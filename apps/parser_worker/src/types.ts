export interface ParseJob {
  jobId: string;
  itemId: string;
  sourceUrl: string;
}

export interface ParseAsset {
  type: "image" | "video" | "file";
  url: string;
  width?: number;
  height?: number;
}

export interface ParseResult {
  title?: string;
  byline?: string;
  excerpt?: string;
  htmlContent?: string;
  markdownContent?: string;
  plainText?: string;
  assets?: ParseAsset[];
  wordCount: number;
  readingMinutes: number;
  parserVersion: string;
}
