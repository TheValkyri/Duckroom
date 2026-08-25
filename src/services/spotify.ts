import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSupabaseAdmin } from "../lib/supabase";
import { requireOwnerMiddleware, serverSecurityMiddleware } from "../lib/auth-guard";

/**
 * Spotify Bridge (Master Plan §14)
 * ---------------------------------------------------------------------------
 * Spotify là EXTERNAL metadata/identity bridge — KHÔNG phải canonical backend:
 * - Không bao giờ chặn playback của Duckroom khi Spotify unavailable (§14.4).
 * - Identity lưu qua bảng generic `external_identities` (§14.3), không rải
 *   cột Spotify-specific vào domain tables.
 * - Chỉ Owner được phép probe/match/link (§7.2).
 *
 * Degradation ladder (AD-8):
 *   1. Web API (client credentials)     → full metadata
 *   2. oEmbed công khai                  → title/thumbnail "partial"
 *   3. Không có gì                       → status "unavailable", app vẫn chạy
 */

export type SpotifyResourceType = "track" | "album" | "playlist" | "artist";

const SPOTIFY_ID_RE = /^[0-9A-Za-z]{16,32}$/;

/** Parse một Spotify URL/share link hoặc URI thô (`spotify:track:id`). */
export function parseSpotifyUrl(input: string): { type: SpotifyResourceType; id: string } | null {
  if (!input || typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw) return null;

  const uriMatch = /^spotify:(track|album|playlist|artist):([0-9A-Za-z]+)$/i.exec(raw);
  if (uriMatch) {
    const kind = uriMatch[1];
    const id = uriMatch[2];
    if (!kind || !id || !SPOTIFY_ID_RE.test(id)) return null;
    return { type: kind.toLowerCase() as SpotifyResourceType, id };
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  if (host !== "open.spotify.com" && host !== "spotify.link") return null;

  // /type/{id} — playlist còn hỗ trợ dạng /user/{uid}/playlist/{pid}
  const segments = url.pathname.split("/").filter(Boolean);
  const known = new Set(["track", "album", "playlist", "artist"]);
  for (let i = 0; i < segments.length - 1; i++) {
    const kind = segments[i];
    const id = segments[i + 1];
    if (!kind || !id) continue;
    if (known.has(kind)) {
      if (!SPOTIFY_ID_RE.test(id)) return null;
      return { type: kind as SpotifyResourceType, id };
    }
  }

  // spotify.link short links chỉ redirect — không có id nội tuyến.
  return null;
}

/**
 * Chuẩn hoá chuỗi cho so khớp metadata (KHÔNG phải lyrics — §10.6 vẫn giữ
 * nguyên tắc không tự sửa nội dung lời bài hát):
 * lowercase → bỏ dấu tiếng Việt → bỏ ký tự dấu câu → gộp khoảng trắng.
 */
export function normalizeForMatch(value: string): string {
  if (!value) return "";
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(value: string): Set<string> {
  return new Set(normalizeForMatch(value).split(" ").filter(Boolean));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export interface MatchInput {
  externalTitle: string;
  externalArtists: string[];
  candidateTitle: string;
  candidateArtist: string;
}

/**
 * Điểm tin cậy khớp local-file (§14.2 "Show confidence").
 * 0..1: ≥0.85 cao · ≥0.60 trung bình · dưới ngưỡng hiển thị cảnh báo.
 * Title chiếm 65%, artist 35%. Unknown > Fake: thiếu dữ liệu ⇒ điểm thấp.
 */
export function computeMatchConfidence({
  externalTitle,
  externalArtists,
  candidateTitle,
  candidateArtist,
}: MatchInput): number {
  const extTitle = normalizeForMatch(externalTitle);
  const candTitle = normalizeForMatch(candidateTitle);
  if (!extTitle || !candTitle) return 0;

  const titleScore = extTitle === candTitle ? 1 : jaccard(tokenSet(externalTitle), tokenSet(candidateTitle));

  let artistScore = 0;
  const extArtists = externalArtists.filter(Boolean);
  if (extArtists.length && candidateArtist) {
    const candSet = tokenSet(candidateArtist);
    if (extArtists.some((a) => normalizeForMatch(a) === normalizeForMatch(candidateArtist))) {
      artistScore = 1;
    } else {
      artistScore = Math.max(...extArtists.map((a) => jaccard(tokenSet(a), candSet)));
    }
  }

  const score = 0.65 * titleScore + 0.35 * artistScore;
  return Math.round(score * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// Server-side probing
// ---------------------------------------------------------------------------

interface CachedToken {
  value: string;
  expiresAtMs: number;
}
let cachedSpotifyToken: CachedToken | null = null;

async function getSpotifyAccessToken(): Promise<string | null> {
  const clientId = process.env["SPOTIFY_CLIENT_ID"]?.trim();
  const clientSecret = process.env["SPOTIFY_CLIENT_SECRET"]?.trim();
  if (!clientId || !clientSecret) return null;

  const now = Date.now();
  if (cachedSpotifyToken && cachedSpotifyToken.expiresAtMs - 30_000 > now) {
    return cachedSpotifyToken.value;
  }

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) return null;
  cachedSpotifyToken = {
    value: json.access_token,
    expiresAtMs: now + (json.expires_in ?? 3600) * 1000,
  };
  return cachedSpotifyToken.value;
}

export interface ProbedSpotifyResource {
  type: SpotifyResourceType;
  externalId: string;
  title: string;
  subtitle: string;
  artworkUrl: string | null;
  externalUrl: string;
  source: "web_api" | "oembed";
  extra: Record<string, string | number | null>;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

async function probeViaWebApi(
  type: SpotifyResourceType,
  id: string,
  token: string,
): Promise<ProbedSpotifyResource | null> {
  const paths: Record<SpotifyResourceType, string> = {
    track: `tracks/${id}`,
    album: `albums/${id}`,
    playlist: `playlists/${id}`,
    artist: `artists/${id}`,
  };
  const res = await fetch(`https://api.spotify.com/v1/${paths[type]}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) return null;
  const j = (await res.json()) as Record<string, unknown>;

  const albumObj = j["album"] as Record<string, unknown> | undefined;
  const imagesArr = (Array.isArray(albumObj?.["images"]) ? albumObj["images"] : j["images"]) as
    Array<{ url?: unknown }> | undefined;
  const image = imagesArr?.[0]?.url;

  const artistsArr = (Array.isArray(j["artists"]) ? j["artists"] : []) as Array<{ name?: unknown }>;
  const ownerObj = j["owner"] as Record<string, unknown> | undefined;
  const artists: string[] = artistsArr.length
    ? artistsArr.map((a) => str(a.name))
    : [str(ownerObj?.["display_name"])].filter(Boolean);

  const base = {
    type,
    externalId: id,
    artworkUrl: typeof image === "string" && image ? image : null,
    externalUrl:
      str((j["external_urls"] as Record<string, unknown> | undefined)?.["spotify"]) ||
      `https://open.spotify.com/${type}/${id}`,
    source: "web_api" as const,
  };
  switch (type) {
    case "track": {
      const durationMs = j["duration_ms"];
      return {
        ...base,
        title: str(j["name"]),
        subtitle: artists.join(", "),
        extra: {
          durationMs: typeof durationMs === "number" ? durationMs : null,
          albumName: str(albumObj?.["name"]) || null,
          releaseYear: str(albumObj?.["release_date"]).slice(0, 4) || null,
        },
      };
    }
    case "album": {
      const totalTracks = j["total_tracks"];
      return {
        ...base,
        title: str(j["name"]),
        subtitle: artists.join(", "),
        extra: {
          totalTracks: typeof totalTracks === "number" ? totalTracks : null,
          releaseYear: str(j["release_date"]).slice(0, 4) || null,
        },
      };
    }
    case "playlist": {
      const tracksObj = j["tracks"] as Record<string, unknown> | undefined;
      const totalTracks = tracksObj?.["total"];
      return {
        ...base,
        title: str(j["name"]),
        subtitle: artists.join(", "),
        extra: { totalTracks: typeof totalTracks === "number" ? totalTracks : null },
      };
    }
    case "artist": {
      const followersObj = j["followers"] as Record<string, unknown> | undefined;
      const followers = followersObj?.["total"];
      return {
        ...base,
        title: str(j["name"]),
        subtitle: "Nghệ sĩ",
        extra: { followers: typeof followers === "number" ? followers : null },
      };
    }
  }
}

async function probeViaOEmbed(type: SpotifyResourceType, id: string): Promise<ProbedSpotifyResource | null> {
  const url = `https://open.spotify.com/${type}/${id}`;
  const res = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`, {
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) return null;
  const j = (await res.json()) as Record<string, unknown>;
  if (!str(j["title"])) return null;
  return {
    type,
    externalId: id,
    title: str(j["title"]),
    subtitle: "",
    artworkUrl: typeof j["thumbnail_url"] === "string" && j["thumbnail_url"] ? j["thumbnail_url"] : null,
    externalUrl: url,
    source: "oembed",
    extra: {},
  };
}

export type SpotifyProbeResult =
  | { status: "ok"; resource: ProbedSpotifyResource }
  | { status: "invalid_url"; reason: string }
  | { status: "unavailable"; reason: string };

/** Core probe logic — được server fn và test cùng dùng. */
export async function probeSpotifyResourceInternal(data: { url: string }): Promise<SpotifyProbeResult> {
  const parsed = parseSpotifyUrl(data.url);
  if (!parsed) {
    return {
      status: "invalid_url",
      reason: "Liên kết không phải Spotify track/album/playlist/artist hợp lệ.",
    };
  }

  // Ladder bậc 1: Web API khi có credentials.
  try {
    const token = await getSpotifyAccessToken();
    if (token) {
      const full = await probeViaWebApi(parsed.type, parsed.id, token);
      if (full) return { status: "ok", resource: full };
    }
  } catch {
    // rơi xuống oEmbed — không được làm sập panel (§14.4).
  }

  // Ladder bậc 2: oEmbed công khai (partial metadata).
  try {
    const partial = await probeViaOEmbed(parsed.type, parsed.id);
    if (partial) return { status: "ok", resource: partial };
  } catch {
    // rơi xuống unavailable.
  }

  return {
    status: "unavailable",
    reason:
      "Không thể truy cập Spotify ngay lúc này (mạng hoặc dịch vụ ngoài). Duckroom vẫn hoạt động bình thường — thử lại sau.",
  };
}

export const probeSpotifyResourceServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireOwnerMiddleware])
  .validator(z.object({ url: z.string().min(8).max(512) }))
  .handler(async ({ data }) => probeSpotifyResourceInternal(data));

export interface LocalMatchCandidate {
  resourceId: string;
  title: string;
  artist: string;
  confidence: number;
}

/** Core match logic — server fn + test cùng dùng. */
export async function findLocalMatchesInternal(data: {
  title: string;
  artists?: string[];
  kind?: "track" | "album" | "video";
  limit?: number;
}): Promise<{ candidates: LocalMatchCandidate[] }> {
  const db = getSupabaseAdmin();
  const kind = data.kind ?? "track";
  const table = kind === "album" ? "albums" : kind === "video" ? "videos" : "tracks";
  const { data: rows, error } = await db.from(table).select("id,title,artist").limit(5000);
  if (error) throw new Error(error.message);

  const artists = data.artists ?? [];
  const candidates: LocalMatchCandidate[] = (rows ?? [])
    .map((row: any) => ({
      resourceId: String(row.id),
      title: String(row.title ?? ""),
      artist: String(row.artist ?? ""),
      confidence: computeMatchConfidence({
        externalTitle: data.title,
        externalArtists: artists,
        candidateTitle: String(row.title ?? ""),
        candidateArtist: String(row.artist ?? ""),
      }),
    }))
    .filter((c) => c.confidence >= 0.35)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, data.limit ?? 8);

  return { candidates };
}

export const findLocalMatchesServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireOwnerMiddleware])
  .validator(
    z.object({
      title: z.string().min(1).max(300),
      artists: z.array(z.string().max(200)).max(10).default([]),
      kind: z.enum(["track", "album", "video"]).default("track"),
      limit: z.number().int().min(1).max(20).default(8),
    }),
  )
  .handler(async ({ data }) => findLocalMatchesInternal(data));

const linkValidator = z.object({
  provider: z.literal("spotify"),
  externalType: z.enum(["track", "album", "artist", "playlist"]),
  externalId: z.string().min(8).max(64),
  externalUrl: z.string().url().max(512).nullable().optional(),
  resourceKind: z.enum(["track", "album", "artist", "playlist", "video"]),
  resourceId: z.string().min(1).max(128),
  confidence: z.number().min(0).max(1).nullable().optional(),
  payload: z.record(z.unknown()).optional(),
});

/** Core link/persist logic — server fn + test cùng dùng. */
export async function linkExternalIdentityInternal(
  data: {
    provider: "spotify";
    externalType: "track" | "album" | "artist" | "playlist";
    externalId: string;
    externalUrl?: string | null | undefined;
    resourceKind: "track" | "album" | "artist" | "playlist" | "video";
    resourceId: string;
    confidence?: number | null | undefined;
    payload?: Record<string, unknown> | undefined;
  },
  actorUserId?: string | null,
): Promise<{ success: boolean }> {
  const db = getSupabaseAdmin();

  // Re-validate locally: resource phải tồn tại trước khi ghi identity.
  const tableByKind: Record<string, string> = {
    track: "tracks",
    album: "albums",
    playlist: "playlists",
    video: "videos",
    artist: "profiles",
  };
  const table = tableByKind[data.resourceKind];
  if (!table) throw new Error("Loại tài nguyên không hợp lệ.");
  const idColumn = table === "profiles" ? "user_id" : "id";
  const { data: exists, error } = await db.from(table).select(idColumn).eq(idColumn, data.resourceId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!exists) throw new Error("Tài nguyên cục bộ không tồn tại trong database.");

  const row = {
    provider: data.provider,
    resource_type: data.externalType,
    external_id: data.externalId,
    external_url: data.externalUrl ?? null,
    resource_kind: data.resourceKind,
    resource_id: data.resourceId,
    match_confidence: data.confidence ?? null,
    linked_by: actorUserId ?? null,
    payload: data.payload ?? null,
  };

  const { error: upsertError } = await db.from("external_identities").upsert(row, {
    onConflict: "provider,resource_type,external_id,resource_kind,resource_id",
  });
  if (upsertError) throw new Error(upsertError.message);

  try {
    await db.from("audit_logs").insert({
      actor_user_id: actorUserId ?? null,
      action: "spotify.identity_linked",
      resource_type: data.resourceKind,
      resource_id: data.resourceId,
      metadata: {
        provider: data.provider,
        external_type: data.externalType,
        external_id: data.externalId,
        confidence: data.confidence ?? null,
      },
    });
  } catch {
    // audit failure không được chặn nghiệp vụ chính
  }

  return { success: true };
}

export const linkExternalIdentityServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireOwnerMiddleware])
  .validator(linkValidator)
  .handler(async ({ context, data }) => {
    const actorUserId = (context as { auth?: { userId?: string | null } })?.auth?.userId ?? null;
    return linkExternalIdentityInternal(data, actorUserId);
  });
