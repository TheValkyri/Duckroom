import { AlertTriangle, ExternalLink, Link2, Loader2, Music, Search } from "lucide-react";
import { motion } from "motion/react";
import { useCallback, useState } from "react";
import { springSnappy, tapScale } from "../../lib/motion";
import { cn } from "../../lib/utils";
import {
  findLocalMatchesServer,
  linkExternalIdentityServer,
  probeSpotifyResourceServer,
  type LocalMatchCandidate,
  type SpotifyProbeResult,
} from "../../services/spotify";
import { SectionCard } from "./SectionCard";

function confidenceColor(score: number): string {
  if (score >= 0.85) return "text-emerald-400 border-emerald-500/30 bg-emerald-500/10";
  if (score >= 0.6) return "text-amber-400 border-amber-500/30 bg-amber-500/10";
  return "text-muted-foreground border-border bg-muted/20";
}

export function SpotifyImportSection() {
  const [url, setUrl] = useState("");
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<SpotifyProbeResult | null>(null);
  const [matches, setMatches] = useState<LocalMatchCandidate[] | null>(null);
  const [matching, setMatching] = useState(false);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const runMatch = useCallback(async (resource: Extract<SpotifyProbeResult, { status: "ok" }>["resource"]) => {
    if (resource.type !== "track") {
      setMatches(null);
      return;
    }
    setMatching(true);
    try {
      const res = await findLocalMatchesServer({
        data: {
          title: resource.title,
          artists: resource.subtitle
            ? resource.subtitle
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : [],
          kind: "track",
          limit: 8,
        },
      });
      setMatches(res.candidates ?? []);
    } catch (err) {
      setMatches([]);
      setNote(err instanceof Error ? err.message : "Không thể tra cứu thư viện cục bộ.");
    } finally {
      setMatching(false);
    }
  }, []);

  const handleProbe = async () => {
    if (!url.trim() || probing) return;
    setProbing(true);
    setProbe(null);
    setMatches(null);
    setNote(null);
    try {
      const res = await probeSpotifyResourceServer({ data: { url: url.trim() } });
      setProbe(res);
      if (res.status === "ok") {
        if (res.resource.source === "oembed") {
          setNote(
            "Metadata rút gọn qua oEmbed (chỉ tiêu đề). Thêm SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET vào môi trường server để tra cứu đầy đủ và khớp chính xác hơn.",
          );
        }
        await runMatch(res.resource);
      }
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Tra cứu Spotify thất bại.");
    } finally {
      setProbing(false);
    }
  };

  const handleLink = async (candidate: LocalMatchCandidate) => {
    if (!probe || probe.status !== "ok" || linkingId) return;
    setLinkingId(candidate.resourceId);
    try {
      await linkExternalIdentityServer({
        data: {
          provider: "spotify",
          externalType: probe.resource.type,
          externalId: probe.resource.externalId,
          externalUrl: probe.resource.externalUrl,
          resourceKind: "track",
          resourceId: candidate.resourceId,
          confidence: candidate.confidence,
          payload: {
            title: probe.resource.title,
            artists: probe.resource.subtitle || null,
            artworkUrl: probe.resource.artworkUrl,
            source: probe.resource.source,
          },
        },
      });
      setNote(
        `Đã liên kết Spotify identity với bài hát trong thư viện (độ tin cậy ${(candidate.confidence * 100).toFixed(0)}%).`,
      );
      setMatches((prev) => prev?.filter((m) => m.resourceId !== candidate.resourceId) ?? null);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Liên kết identity thất bại.");
    } finally {
      setLinkingId(null);
    }
  };

  return (
    <SectionCard
      title="Spotify Import — Identity Bridge"
      description="Dán liên kết Spotify để lấy metadata ngoài và khớp với bài hát cục bộ. Spotify chỉ là lớp nhận diện; Duckroom vẫn giữ file và playback của mình."
      icon={Link2}
    >
      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://open.spotify.com/track/…"
          aria-label="Spotify link"
          className="bg-background/60 placeholder:text-muted-foreground/60 h-10 flex-1 rounded-full border border-border px-4 text-sm outline-none focus:border-primary/50"
        />
        <motion.button
          whileTap={tapScale}
          transition={springSnappy}
          disabled={probing || !url.trim()}
          onClick={() => void handleProbe()}
          className="flex items-center gap-2 rounded-full bg-primary px-4 py-1.5 text-xs font-semibold shadow transition-colors hover:bg-accent cursor-pointer disabled:opacity-50"
        >
          <Search className={probing ? "size-3.5 animate-spin" : "size-3.5"} />
          Tra cứu
        </motion.button>
      </div>

      {probe?.status === "invalid_url" && (
        <p className="mt-4 flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-400">
          <AlertTriangle className="size-3.5 shrink-0" /> {probe.reason}
        </p>
      )}
      {probe?.status === "unavailable" && (
        <p className="text-muted-foreground mt-4 flex items-center gap-2 rounded-xl border border-border bg-muted/10 p-3 text-xs">
          <AlertTriangle className="size-3.5 shrink-0 text-amber-400" /> {probe.reason}
        </p>
      )}
      {probe?.status === "ok" && (
        <div className="border-border bg-card/60 mt-4 flex items-start gap-4 rounded-2xl border p-4">
          {probe.resource.artworkUrl ? (
            <img src={probe.resource.artworkUrl} alt="" className="size-16 rounded-xl object-cover shadow" />
          ) : (
            <div className="bg-muted grid size-16 place-items-center rounded-xl">
              <Music className="text-muted-foreground size-6" />
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{probe.resource.title}</p>
            <p className="text-muted-foreground truncate text-xs">{probe.resource.subtitle || "(không rõ nghệ sĩ)"}</p>
            <p className="text-muted-foreground mt-1 font-mono text-[10px] uppercase">
              {probe.resource.type} · nguồn: {probe.resource.source === "web_api" ? "Web API" : "oEmbed"}
            </p>
          </div>
          <a
            href={probe.resource.externalUrl}
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground hover:text-primary ml-auto shrink-0 p-2 transition-colors"
            title="Mở trên Spotify"
          >
            <ExternalLink className="size-4" />
          </a>
        </div>
      )}

      {matching && (
        <p className="text-muted-foreground mt-3 flex items-center gap-2 text-xs">
          <Loader2 className="size-3.5 animate-spin text-primary" /> Đang khớp với thư viện cục bộ…
        </p>
      )}

      {matches && matches.length > 0 && probe?.status === "ok" && (
        <div className="mt-4 space-y-2">
          <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">Ứng viên khớp cục bộ</p>
          {matches.map((c) => (
            <div
              key={c.resourceId}
              className="border-border bg-background/40 flex items-center gap-3 rounded-xl border px-3 py-2.5"
            >
              <span
                className={cn(
                  "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold tabular-nums",
                  confidenceColor(c.confidence),
                )}
              >
                {(c.confidence * 100).toFixed(0)}%
              </span>
              <span className="min-w-0 flex-1 truncate text-xs">
                <strong className="font-medium">{c.title}</strong>
                <span className="text-muted-foreground"> · {c.artist}</span>
                <span className="text-muted-foreground/60 ml-2 font-mono">{c.resourceId.slice(0, 8)}</span>
              </span>
              <motion.button
                whileTap={tapScale}
                transition={springSnappy}
                disabled={linkingId !== null}
                onClick={() => void handleLink(c)}
                className="shrink-0 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold text-emerald-400 transition-colors hover:bg-emerald-500/20 cursor-pointer disabled:opacity-50"
              >
                {linkingId === c.resourceId ? "Đang lưu…" : "Liên kết"}
              </motion.button>
            </div>
          ))}
        </div>
      )}
      {matches && matches.length === 0 && probe?.status === "ok" && probe.resource.type === "track" && !matching && (
        <p className="text-muted-foreground mt-3 text-xs">Không tìm thấy ứng viên nào đủ tin cậy trong thư viện.</p>
      )}

      {note && <p className="text-muted-foreground mt-3 text-xs leading-5">{note}</p>}
    </SectionCard>
  );
}
