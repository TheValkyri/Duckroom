import { FileCode, Film, ImageIcon, Music } from "lucide-react";

export function getFileTypeInfo(key: string) {
  const lower = key.toLowerCase();
  if (lower.match(/\.(jpg|jpeg|png|webp|gif|avif)$/) || lower.startsWith("artwork/") || lower.startsWith("artworks/")) {
    return { type: "image" as const, label: "Ảnh Artwork", Icon: ImageIcon, color: "text-blue-400" };
  }
  if (lower.match(/\.(mp4|mkv|webm|mov)$/) || lower.startsWith("videos/")) {
    return { type: "video" as const, label: "Video MV", Icon: Film, color: "text-purple-400" };
  }
  if (lower.match(/\.(flac|wav|mp3|m4a|alac|ogg|aac)$/) || lower.startsWith("audio/")) {
    return { type: "audio" as const, label: "Âm thanh Master", Icon: Music, color: "text-emerald-400" };
  }
  return { type: "other" as const, label: "Tập tin dữ liệu", Icon: FileCode, color: "text-amber-400" };
}
