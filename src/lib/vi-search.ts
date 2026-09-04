/**
 * Diacritic-insensitive text matching (F1 2026-09-04).
 *
 * Người Việt gõ nhanh thường bỏ dấu ("dam cuoi" → "Đám Cưới") — tìm theo
 * chuỗi raw sẽ miss hoàn toàn. Chuẩn hóa 2 phía (query + dữ liệu) về dạng
 * "không dấu + thường + gọn khoảng trắng" rồi so khớp chuỗi con.
 *
 * Map thủ công thay vì NFD-normalize + strip marks vì:
 * - NFD tách "ậ" thành "a" + 2 combining marks — strip bằng regex Unicode
 *   property (\p{M}) đúng nhưng chậm hơn map lookup khi gọi mỗi keystroke.
 * - Một số ký tự (đ/Đ) không tách NFD được (tiếng Việt dùng precomposed).
 * Map 1 lần cho toàn bộ 7 dấu + 11 nguyên âm là đủ cho tiếng Việt.
 * ("aa" → "â" kiểu telex KHÔNG xử lý — quá mơ hồ, dễ match nhầm.)
 */

const DIACRITIC_MAP: Record<string, string> = {
  a: "a",
  á: "a",
  à: "a",
  ả: "a",
  ã: "a",
  ạ: "a",
  ă: "a",
  ắ: "a",
  ằ: "a",
  ẳ: "a",
  ẵ: "a",
  ặ: "a",
  â: "a",
  ấ: "a",
  ầ: "a",
  ẩ: "a",
  ẫ: "a",
  ậ: "a",
  e: "e",
  é: "e",
  è: "e",
  ẻ: "e",
  ẽ: "e",
  ẹ: "e",
  ê: "e",
  ế: "e",
  ề: "e",
  ể: "e",
  ễ: "e",
  ệ: "e",
  i: "i",
  í: "i",
  ì: "i",
  ỉ: "i",
  ĩ: "i",
  ị: "i",
  o: "o",
  ó: "o",
  ò: "o",
  ỏ: "o",
  õ: "o",
  ọ: "o",
  ơ: "o",
  ớ: "o",
  ờ: "o",
  ở: "o",
  ỡ: "o",
  ợ: "o",
  ô: "o",
  ố: "o",
  ồ: "o",
  ổ: "o",
  ỗ: "o",
  ộ: "o",
  u: "u",
  ú: "u",
  ù: "u",
  ủ: "u",
  ũ: "u",
  ụ: "u",
  ư: "u",
  ứ: "u",
  ừ: "u",
  ử: "u",
  ữ: "u",
  ự: "u",
  y: "y",
  ý: "y",
  ỳ: "y",
  ỷ: "y",
  ỹ: "y",
  ỵ: "y",
  d: "d",
  đ: "d",
};

/** Chuẩn hóa 1 chuỗi về dạng so khớp: thường + bỏ dấu tiếng Việt + gọn space. */
export function viFold(input: string): string {
  if (!input) return "";
  const lowered = input.toLowerCase();
  let out = "";
  for (const ch of lowered) {
    out += DIACRITIC_MAP[ch] ?? ch;
  }
  // Gộp khoảng trắng thừa (kể cả non-breaking) + trim.
  return out.replace(/[\s\u00A0]+/g, " ").trim();
}
