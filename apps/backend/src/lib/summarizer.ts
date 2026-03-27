export interface SummarySourceInput {
  plainText?: string;
  markdownContent?: string;
  htmlContent?: string;
}

export interface GeneratedSummary {
  summaryText: string;
  keyPoints: string[];
  summaryShort: string;
}

const MAX_KEY_POINTS = 3;
const MAX_SUMMARY_SENTENCES = 3;
const MAX_SUMMARY_CHARS = 420;
const MAX_KEY_POINT_CHARS = 150;
const STRIP_MARKDOWN = /[*_~`>#\[\]\(\)!-]/g;
const STRIP_HTML = /<[^>]+>/g;

export function generateSummary(input: SummarySourceInput): GeneratedSummary | null {
  const source = pickSourceText(input);
  if (!source) {
    return null;
  }

  const sentences = splitSentences(source);
  if (sentences.length === 0) {
    return null;
  }

  const summaryText = limitText(sentences.slice(0, MAX_SUMMARY_SENTENCES).join(" "), MAX_SUMMARY_CHARS);
  if (!summaryText) {
    return null;
  }

  const ranked = [...sentences]
    .map((sentence, index) => ({
      sentence,
      score: sentenceScore(sentence, index)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_KEY_POINTS)
    .map((entry) => limitText(entry.sentence, MAX_KEY_POINT_CHARS))
    .filter(Boolean);

  const keyPoints = ranked.length > 0 ? ranked : [summaryText];
  return {
    summaryText,
    keyPoints,
    summaryShort: keyPoints[0] ?? summaryText
  };
}

function pickSourceText(input: SummarySourceInput): string {
  const plain = normalize(input.plainText ?? "");
  if (plain) {
    return plain;
  }
  const markdown = normalize((input.markdownContent ?? "").replaceAll(STRIP_MARKDOWN, " "));
  if (markdown) {
    return markdown;
  }
  const html = normalize((input.htmlContent ?? "").replaceAll(STRIP_HTML, " "));
  return html;
}

function normalize(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim();
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？.!?])\s+|[\r\n]+/g)
    .map((part) => normalize(part))
    .filter((part) => part.length >= 18);
}

function sentenceScore(sentence: string, index: number): number {
  const lengthScore = Math.min(sentence.length, 180);
  const leadBonus = index === 0 ? 80 : Math.max(0, 40 - index * 5);
  const numberBonus = /\d/.test(sentence) ? 20 : 0;
  return lengthScore + leadBonus + numberBonus;
}

function limitText(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars - 1).trimEnd()}...`;
}
