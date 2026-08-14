import type { LyricLine } from "../data/library";

/**
 * Common Vietnamese spelling mistakes and orthographic errors dictionary.
 * Maps misspelled words to correct Vietnamese standard orthography.
 */
const SPELLING_CORRECTIONS: [RegExp, string][] = [
  // User reported specific typos & common Vietnamese lyrics misspellings
  [/\bxám\s+hối\b/gi, "sám hối"],
  [/\bXám\s+hối\b/g, "Sám hối"],
  [/\bXÁM\s+HỐI\b/g, "SÁM HỐI"],
  [/\bbạc\s+mạng\b/gi, "bạt mạng"],
  [/\bsáng\s+lạng\b/gi, "xán lạn"],
  [/\bchuẩn\s+đoán\b/gi, "chẩn đoán"],
  [/\bxơ\s+suất\b/gi, "sơ suất"],
  [/\bsơ\s+xuất\b/gi, "sơ suất"],
  [/\bvô\s+hình\s+chung\b/gi, "vô hình trung"],
  [/\bxuất\s+xắc\b/gi, "xuất sắc"],
  [/\bchấp\s+vá\b/gi, "chắp vá"],
  [/\bdành\s+dật\b/gi, "giành giật"],
  [/\bgiành\s+dật\b/gi, "giành giật"],
  [/\bchau\s+chuốt\b/gi, "trau chuốt"],
  [/\bchín\s+chu\b/gi, "chỉn chu"],
  [/\bphố\s+sá\b/gi, "phố xá"],
  [/\bsót\s+xa\b/gi, "xót xa"],
  [/\bxúc\s+tích\b/gi, "súc tích"],
  [/\bdấu\s+giếm\b/gi, "giấu giếm"],
  [/\bgiành\s+dụm\b/gi, "dành dụm"],
  [/\bđầy\s+ấp\b/gi, "đầy ắp"],
  [/\brãnh\s+rỗi\b/gi, "rảnh rỗi"],
  [/\bchăn\s+chở\b/gi, "trăn trở"],
  [/\blãng\s+mạn\b/gi, "lãng mạn"],
  [/\blãng\s+mạng\b/gi, "lãng mạn"],
  [/\bgiục\s+giã\b/gi, "giục giã"],
  [/\bdục\s+dã\b/gi, "giục giã"],
  [/\bngăn\s+nắp\b/gi, "ngăn nắp"],
  [/\bchìm\s+nghỉm\b/gi, "chìm nghỉm"],
  [/\btấc\s+bật\b/gi, "tất bật"],
];

/**
 * Cleans up and corrects Vietnamese lyrics text:
 * - Fixes common typos (e.g. "xám hối" -> "sám hối")
 * - Cleans irregular punctuation spacing (e.g. "tội , mỗi đêm" -> "tội, mỗi đêm")
 * - Normalizes spacing around brackets/parentheses and quotes
 * - Cleans duplicate punctuation marks
 * - Unicode NFC normalization
 */
export function correctVietnameseLyrics(text: string): string {
  if (!text || typeof text !== "string") return "";

  let cleaned = text.normalize("NFC");

  // Apply Vietnamese dictionary corrections
  for (const [regex, replacement] of SPELLING_CORRECTIONS) {
    cleaned = cleaned.replace(regex, (match) => {
      // Preserve first character capitalization
      if (match.charAt(0) === match.charAt(0).toUpperCase()) {
        return replacement.charAt(0).toUpperCase() + replacement.slice(1);
      }
      return replacement;
    });
  }

  // Fix spacing before punctuation: "tội , mỗi" -> "tội, mỗi"
  cleaned = cleaned.replace(/\s+([,.:;!?])/g, "$1");

  // Fix missing space after punctuation: "113(ba," -> "113 (ba," and ",theo" -> ", theo"
  cleaned = cleaned.replace(/([,.:;!?])(?=[^\s\d"')\]}])/g, "$1 ");

  // Fix missing space before open parenthesis or bracket: "lệnh(113)" -> "lệnh (113)"
  cleaned = cleaned.replace(/([a-zA-Z0-9\u00C0-\u024F\u1EA0-\u1EF9])\(/g, "$1 (");

  // Fix spaces inside parentheses: "( ba, ba, ba )" -> "(ba, ba, ba)"
  cleaned = cleaned.replace(/\(\s+/g, "(").replace(/\s+\)/g, ")");

  // Fix spaces inside double quotes: '" Thua rồi "' -> '"Thua rồi"'
  cleaned = cleaned.replace(/“\s+/g, "“").replace(/\s+”/g, "”");
  cleaned = cleaned.replace(/"\s+([^"]+?)\s+"/g, '"$1"');

  // Fix multiple commas/spaces: ",," -> ","
  cleaned = cleaned.replace(/,{2,}/g, ",");
  cleaned = cleaned.replace(/[ \t]{2,}/g, " ");

  return cleaned.trim();
}

/**
 * Parses LRC text into synchronized LyricLine array, automatically
 * applying Vietnamese orthography corrections and formatting.
 */
export function parseLrcWithAutoCorrect(lrcText: string): LyricLine[] {
  if (!lrcText || !lrcText.trim()) return [];
  const lines = lrcText.split(/\r?\n/);
  const result: LyricLine[] = [];
  const regex = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\](.*)/;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    const match = regex.exec(trimmed);
    if (match) {
      const min = parseInt(match[1]!, 10);
      const sec = parseInt(match[2]!, 10);
      const rawContent = match[4] || "";
      const text = correctVietnameseLyrics(rawContent);
      if (text) {
        result.push({ time: min * 60 + sec, text });
      }
    } else if (trimmed && !trimmed.startsWith("[")) {
      const text = correctVietnameseLyrics(trimmed);
      if (text) {
        result.push({ time: 0, text });
      }
    }
  }

  return result.sort((a, b) => a.time - b.time);
}

/**
 * Beautifies entire LRC content string for display in edit textareas.
 */
export function beautifyLrcString(lrcText: string): string {
  if (!lrcText) return "";
  const lines = lrcText.split(/\r?\n/);
  const regex = /^(\[\d{2}:\d{2}(?:\.\d{2,3})?\])(.*)$/;

  const beautified = lines.map((line) => {
    const match = regex.exec(line.trim());
    if (match) {
      const tag = match[1];
      const content = correctVietnameseLyrics(match[2]);
      return `${tag} ${content}`.trim();
    }
    return correctVietnameseLyrics(line);
  });

  return beautified.join("\n");
}
