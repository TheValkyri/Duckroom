# DUCKROOM — AGENT CONTEXT / IMPLEMENTATION BRIEF

## 1. Mission

Duckroom is being evolved from a visually polished personal music-vault prototype into a **Spotify-like personal music platform** with its own identity, data ownership, master files, lyrics, artwork and playback experience.

The core product promise is:

> **Your music, your library, Duckroom controls the experience and preserves the original master.**

Do not turn Duckroom into a Spotify clone, generic CRUD dashboard, file browser, or cartoon app.

## 2. User roles

### Guest
- No account required.
- Browse public Duckroom library.
- Play tracks/videos.
- View artwork and lyrics.
- Share links.
- Temporary queue/UI preferences are acceptable.
- Cannot persist favorites/playlists/history.
- Clicking Favorite/playlist persistence should open a polished authentication gate.

### Member
- Auth: email/password and Google.
- Full consumer experience.
- Persistent favorites.
- Personal playlists.
- Recently played/history.
- Playback position / continue listening.
- Personal library customization.
- Cannot modify the master library.
- Cannot upload/delete/edit master content.

### Owner
- Single highest-privilege role.
- Upload, edit metadata, artwork, lyrics, storage, videos.
- User administration.
- Storage/integrity tools.
- Audit logs.
- Backups / recovery.
- Destructive actions.

No fail-open development admin fallback is allowed.

## 3. Product priorities

User-stated priority order:
1. UI/UX and experience
2. Lyrics
3. Security
4. Upload quality / QoL
5. Audio quality

Engineering execution priority is different:
1. Security and authorization
2. Data integrity / source of truth
3. Player reliability / media correctness
4. UX architecture
5. Feature polish

The product must ultimately be **correct + fast + beautiful**.

## 4. Non-negotiable UX/design traits

- Modern, strong, chill, cinematic, distinctive.
- Dark mode primary; light mode must be first-class.
- Duck mascot and audio waveform are core visual DNA.
- Avoid generic Spotify/Apple Music imitation.
- Motion is a core product quality, not decoration.
- Avoid janky, stacked, random, or excessive animation.
- Target 60 FPS for important interactions.
- Respect reduced-motion preferences.
- Progressive loading; avoid spinner-heavy UI.
- Optimistic UI where safe, with rollback on failure.

## 5. Audio direction

- Lossless-first.
- Never silently transcode or mutate masters.
- Actual metadata must come from real media analysis; never hardcode claims such as 24-bit/96 kHz, 4K or codec values.
- Preserve source format.
- Track formats should represent FLAC, ALAC, WAV, MP3, M4A and UNKNOWN.
- ReplayGain is desired and should affect playback only.
- Crossfade: user configurable, max 10 seconds.
- Gapless playback is highly desired but must be described honestly as browser best-effort.
- True bit-perfect / WASAPI-exclusive / ASIO is a possible future desktop/native feature; do not falsely claim the browser is bit-perfect.
- Browser player should prioritize maximum practical fidelity and stability.

## 6. Lyrics direction

Lyrics are a flagship feature.

Desired:
- Embedded lyrics.
- Community/provider search.
- Multiple sources with source/confidence information.
- Synced LRC.
- Plain lyrics.
- Global offset (e.g. -1.2s) without editing every timestamp.
- Timeline-style editor with waveform/playhead.
- Live preview alongside editing.
- Fine nudge controls.
- Version history.
- Manual verification.

Do **not** auto-correct Vietnamese lyric wording anymore. Only perform structural cleanup (timestamps/whitespace/order) when explicitly requested.

## 7. Upload direction

Preferred workflow:

1. Select one or many files.
2. Analyze locally / server-side.
3. Extract real metadata.
4. Extract artwork.
5. Search lyrics.
6. Match Spotify metadata when desired.
7. Detect duplicate via checksum/content identity.
8. Show a review center.
9. Allow bulk and per-track edits.
10. User explicitly confirms.
11. Upload master/artwork.
12. Verify transfer.
13. Commit canonical DB record.

A failed artwork upload must not be silently ignored.

Batch upload is desirable. Controlled concurrency is preferable to 100 concurrent uploads. Resumable/multipart upload is a later reliability/scale improvement.

## 8. Spotify integration

Spotify must **not** become Duckroom's audio backend.

Desired role: **metadata / music-identity bridge**.

Examples:
- Paste Spotify track/album/playlist URL.
- Resolve metadata/artwork/reference IDs.
- Match a user's local master file to Spotify identity.
- Keep Duckroom's own FLAC/WAV/etc. as the playback source.
- If Spotify is unavailable, Duckroom must continue operating.
- Store external identity references (Spotify ID/URL/ISRC if available) rather than depending on Spotify at runtime.

## 9. Storage / infrastructure

- Vercel hosts the web app.
- Pikamc S3 is the current binary storage provider.
- Supabase is intended for Auth + canonical database metadata + RLS/user data.
- S3 bucket must remain private.
- S3 service credentials are SERVER ONLY.
- No VITE_* secret keys.
- Short-lived signed playback URLs are preferred.
- Do not store long-lived signed URLs as canonical metadata.
- S3 object keys should eventually be ID-centric (e.g. audio/{trackId}/master.flac), not filename-driven.

## 10. Canonical data architecture

Target:

- Supabase PostgreSQL = canonical metadata and user data.
- S3 = canonical media/artwork binary objects.
- TanStack Query / client store = cache, not database.
- localStorage = UI preferences / light local state only.
- library_manifest.json = legacy migration/recovery artifact, not runtime source of truth.

Do not expand the current mutable global arrays + manifest + localStorage architecture.

## 11. User library features

Members need:
- Favorites / liked tracks.
- Playlists per user.
- Recently played.
- Continue listening / playback position.
- Custom library shelves/preferences.
- Persistent queue is desirable.
- No recommendation algorithm is required.

## 12. Sharing

Desired professional short links such as:
`/s/{shortId}`

Requirements:
- Server-resolved resource.
- No exposure of S3 storage URL as the public share URL.
- OpenGraph metadata for Discord/Facebook/Zalo/etc. as supported by the platform.
- Artwork + title + artist preview.
- Revocable and optionally expiring share links.

## 13. Video

Video is primarily an archive for music videos/MVs.

Supported storage targets:
- MP4
- MKV
- WebM
- MOV

Browser playback support must be represented honestly; MKV is not guaranteed to play depending on codec/browser.

Subtitles are desired:
- Embedded tracks where possible.
- WebVTT.
- SRT.
- ASS when browser workflow permits.

HLS/DASH/transcoding is not an immediate requirement at current scale (<50 videos, ~5GB max per file), but may be introduced later.

## 14. Backup/recovery

Desired guardrails:
- Private bucket.
- Soft delete / Trash.
- Database backups.
- Metadata snapshots.
- Integrity scan.
- Orphan scan.
- Restore workflow.

A hard delete should never be the default UX for valuable masters.

## 15. Critical current-project problems already identified

- Hardcoded Supabase service-role key exists in source.
- Hardcoded Pikamc S3 credentials exist in source.
- `.env.example` previously exposed `VITE_S3_SECRET_ACCESS_KEY` pattern.
- Missing security config previously failed open to admin/dev.
- Auth previously authorized every authenticated user even if not whitelisted.
- `is_admin` was not a robust role model.
- Server security middleware was previously a no-op.
- S3 read URLs were previously 7 days.
- Master metadata had hardcoded bit depth/sample rate.
- Video technical metadata was hardcoded.
- MP3/M4A were not represented correctly in the Track format model.
- `prev()` player logic reset time before checking the restart threshold.
- Library manifest synchronization ignored valid empty arrays.
- Delete operations were fire-and-forget, risking UI/remote inconsistency.
- Shared client code used a Supabase localStorage key string tied to a project reference.
- Client/global mutable arrays act as a pseudo database.
- `library_manifest.json` is being used as runtime source of truth.
- Fuzzy album matching can create incorrect relationships.
- Errors were sometimes collapsed into empty-state results.

## 16. Current implementation work already applied in this repository snapshot

This snapshot contains the first hardening pass:

- Fail-closed authorization.
- Explicit member/owner roles in server auth resolution.
- Owner-only middleware for destructive/master-library operations.
- Removal of hardcoded Supabase service-role fallback.
- Removal of hardcoded S3 credential fallbacks.
- Server-only secret environment helpers.
- Removal of VITE S3 secret variables from `.env.example`.
- Origin validation middleware.
- Shorter 15-minute playback signed URLs.
- Owner-only S3 list/delete/manifest write/upload operations.
- Content-length passed to upload signing.
- Artwork upload HTTP result checking.
- Realistic `UNKNOWN` / MP3 / M4A format model instead of silently labeling files FLAC.
- Bit depth/sample rate upload defaults no longer claim 24-bit/96kHz; unknown is represented as 0 pending real analysis.
- Player previous/restart behavior fixed.
- Vietnamese lyric auto-correction removed from library hydration.
- Delete operation waits for remote delete success before mutating local library.
- Manifest empty arrays now replace local state instead of being treated as “no update”.
- V2 Supabase foundation migration added for profiles, roles, favorites, playlists, playback state/history, share links and audit logs.

## 17. Important limitations

The codebase does NOT yet contain the full V2 product implementation. Missing or partial future phases include:
- Canonical DB-driven library runtime.
- Full member favorite/playlist UI and mutations.
- Spotify import service/UI.
- Full media analysis with authoritative server-side codec inspection.
- SHA-256/duplicate pipeline.
- Resumable/multipart uploads.
- Full share route / OpenGraph implementation.
- Full owner dashboard/health center.
- Full backup/restore system.
- Player state-machine rewrite.
- ReplayGain analysis pipeline.
- Full lyrics timeline editor rewrite.

Agents must continue from the Master Plan instead of re-inventing these decisions.

## 18. Engineering principles

1. Security fails closed.
2. Database is canonical for metadata/user state.
3. S3 is canonical for binary masters.
4. Never store signed URLs as canonical data.
5. Never fake media metadata.
6. Never silently mutate user/artwork/lyrics/master data.
7. UI should not know infrastructure details.
8. Domain logic should be testable without the browser.
9. Playback must not be coupled to React rendering churn.
10. Do not optimize for hypothetical scale at the expense of clarity, but keep clean boundaries for future growth.
11. Prefer predictable UX over flashy motion.
12. No feature is “done” without failure-state handling and verification.

## 19. Reference documents

- `DUCKROOM_MASTER_PLAN.md` — full engineering/product plan.
- `DUCKROOM_AUDIT_PLAN.md` — historical audit; some findings are outdated.
- `supabase/schema.sql` — legacy schema.
- `supabase/migrations/20260819_duckroom_v2_core.sql` — V2 foundation migration.
