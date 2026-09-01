# DUCKROOM — MASTER ENGINEERING & PRODUCT PLAN

> **Tài liệu chiến lược cấp Senior Fullstack / Product Engineering Lead**
>
> Mục tiêu của tài liệu này là chuyển Duckroom từ một prototype music vault có UI tốt thành một **Spotify-like personal music platform** có kiến trúc production-grade, nhưng vẫn giữ DNA riêng: **waveform + duck + visual identity + lyrics-first experience + smooth motion + lossless-first playback**.

---

## 0. EXECUTIVE DECISION

### 0.1. Quyết định lớn nhất

Duckroom **không được tiếp tục phát triển theo kiểu patch-on-patch** trên kiến trúc hiện tại.

Ta giữ lại product DNA và phần UI/UX tốt, nhưng refactor mạnh các lớp core:

- Authentication / Authorization
- Data model
- Persistence
- Storage boundary
- Media analysis
- Upload pipeline
- Player engine
- User library
- Lyrics subsystem
- Error model
- Observability

### 0.2. Kiến trúc mục tiêu

```text
                           DUCKROOM
                              |
             +----------------+----------------+
             |                |                |
           GUEST            MEMBER            OWNER
             |                |                |
        Public play      Personal data       Full control
        Lyrics           Favorites            Upload
        Share            Playlists            Metadata
        Browse           History              Storage
                         Settings             Users
                              |
                              v
                    +----------------------+
                    |  DOMAIN / API LAYER  |
                    +----------+-----------+
                               |
                +--------------+---------------+
                |                              |
                v                              v
       SUPABASE POSTGRES                  PIKAMC S3
       canonical metadata                binary masters
                |                              |
                +--------------+---------------+
                               |
                               v
                       DUCKROOM PLAYER
                               |
                    +----------+----------+
                    |          |          |
                  Audio      Lyrics      Visual

        Spotify = external identity / metadata / import bridge
        NOT the canonical audio backend.
```

### 0.3. Nguyên tắc bất biến

1. **Supabase PostgreSQL là canonical metadata source of truth.**
2. **Pikamc S3 là canonical binary storage.**
3. **Client cache không phải database.**
4. **`library_manifest.json` không còn là runtime database.** Chỉ giữ làm migration/recovery/snapshot trong giai đoạn chuyển tiếp.
5. **Master audio/video không được tự ý transcode hoặc mutate.**
6. **Metadata kỹ thuật phải được đo từ file thật, không hardcode.**
7. **Guest có thể nghe public content nhưng không có persistent personal library.**
8. **Member có personal Favorites / Playlist / History / playback state nhưng không có quyền admin.**
9. **Owner là role cuối cùng và được enforce ở server.**
10. **Spotify chỉ là identity/import layer; Duckroom vẫn giữ file, data và playback của mình.**
11. **Animation phải smooth vì kiến trúc và rendering đúng, không phải vì nhồi thêm transition.**
12. **Mọi destructive mutation phải rõ ràng, recoverable nếu có thể.**
13. **Không được giả mạo quality metadata.** Unknown > Fake.
14. **Không claim “bit-perfect”, “0ms latency”, “100% gapless” nếu browser không thể bảo đảm tuyệt đối.**

---

# 1. PRODUCT VISION

## 1.1. Duckroom là gì?

Duckroom là một **personal music platform** có UX lấy cảm hứng từ Spotify/Apple Music/Tidal/Plex nhưng không phải clone của chúng.

Duckroom tập trung vào:

- Music library cá nhân
- Lossless-first playback
- Lyrics là feature hạng nhất
- Artwork là identity của nghệ sĩ
- Smooth / cinematic UI
- User library cá nhân
- Upload + media ingestion chất lượng cao
- Archive MV/video
- Share link chuyên nghiệp
- Spotify metadata/import bridge
- Owner administration

## 1.2. Duckroom không phải

- Một Spotify clone.
- Một generic dashboard.
- Một S3 file browser.
- Một JSON manifest database.
- Một “fake Hi-Res” player.
- Một system recommendation algorithm.
- Một hệ thống DRM nặng ngay từ v1.

## 1.3. User roles

### Guest

Được:

- Browse public library
- Play
- Lyrics
- Artwork
- Queue tạm thời
- Share
- Theme / player preference local

Không được:

- Persistent Favorites
- Persistent Playlists
- Persistent History
- Upload
- Edit master metadata
- Delete
- Admin

Khi guest bấm Favorite / Add Playlist / persistent action:

> Hiển thị auth gate đẹp, giải thích lợi ích của Member, không ép chuyển trang một cách thô.

### Member

Được:

- Toàn bộ quyền Guest
- Favorites
- Personal playlists
- Recently played
- Continue listening
- Playback state
- User settings
- Custom library sections
- Share

Không được:

- Upload master
- Edit master metadata
- Delete master
- Storage management
- User management
- Admin settings

### Owner

Được toàn bộ Member +:

- Upload
- Edit master metadata
- Lyrics moderation/verification
- Artwork management
- Video management
- User management
- Storage diagnostics
- Duplicate detection
- Orphan scanner
- Backup / restore
- Audit logs
- Security settings
- System health

---

# 2. CURRENT STATE — ĐIỂM XUẤT PHÁT

## 2.1. Những gì hiện tại đang tốt

### Product / UX

- Visual identity đã có.
- Duck icon và waveform có giá trị thương hiệu.
- Dark aesthetic tốt.
- Player nhiều feature.
- Queue reorder.
- Lyrics subsystem có chiều sâu.
- Artwork workflow có nền tảng.
- Reduced motion đã được quan tâm.
- Visualizer có ý thức về tab/background performance.
- Responsive shell khá tốt.

### Engineering

- React 19 / TanStack / Motion / Supabase / S3 là stack đủ mạnh.
- S3 pagination đã được xử lý.
- Storage key sanitization đã cải thiện.
- File ID giúp giảm collision.
- Signed URL cleanup cho track đã được cải thiện.

## 2.2. Những gì hiện tại không đạt target

### Critical / P0

- Auth có fail-open fallback.
- Có hardcoded/default secret material trong source/config pattern.
- Server-only boundary chưa đủ chặt.
- Whitelist/authorization semantics chưa khớp product model.
- Supabase DB chưa phải canonical source of truth.
- S3 manifest/local mutable arrays đang đóng vai database.
- Media technical metadata đang có hardcoded/fake defaults.

### High / P1

- Manifest concurrency chưa có versioning.
- Empty manifest bị hiểu sai như “không có update”.
- Clear library chưa đảm bảo remote canonical state.
- Delete có thể fire-and-forget và tạo orphan.
- Upload artifact failures có thể không block commit.
- Player state logic còn mong manh.
- `prev()` có bug logic do reset time trước khi kiểm tra restart threshold.
- Error handlers có thể biến network/storage failure thành empty state.
- Album matching có fuzzy logic không phù hợp cho canonical relation.
- Signed URL lifecycle quá dài so với policy mong muốn.

### Medium / P2

- Chưa có duplicate detection.
- Chưa có checksum/integrity.
- Chưa có resumable/multipart upload.
- Chưa có schema validation xuyên boundary.
- Không có complete test suite.
- Documentation có claim mạnh hơn implementation.
- User library chưa tồn tại dưới dạng data model.
- Share links chưa có.
- Spotify integration chưa có.

---

# 3. NON-NEGOTIABLE QUALITY BAR

Duckroom V2 chỉ được coi là đạt khi đồng thời đúng 4 trục:

```text
CORRECT
+ SECURE
+ FAST
+ BEAUTIFUL
```

Không được dùng một trục để biện minh cho việc bỏ trục khác.

## 3.1. Audio quality bar

- Master file giữ nguyên.
- Không tự transcode.
- Codec/sample rate/bit depth/duration lấy từ actual media analysis.
- Không hiển thị metadata giả.
- Playback ưu tiên native/lossless source.
- ReplayGain là playback-only.
- Crossfade có thể cấu hình 0–10s.
- Gapless là best-effort trên web, không claim tuyệt đối.
- Bit-perfect là target cho future desktop/native mode, không giả vờ browser đã làm được.

## 3.2. UX quality bar

- User feedback gần như ngay lập tức.
- Optimistic update ở thao tác phù hợp.
- Error có rollback.
- Loading có skeleton/progressive disclosure.
- Không dùng spinner vô tận cho mọi thứ.
- Không surprise mutation.
- Destructive action có confirmation/undo/Trash nếu có thể.

## 3.3. Motion quality bar

- Target 60 FPS cho UI tương tác chính.
- Animation có motion system thống nhất.
- Không animation chồng chéo vô lý.
- Không animate mọi thứ.
- `prefers-reduced-motion` được hỗ trợ đúng.
- Player playback không được phụ thuộc vào render performance của UI.

---

# 4. TARGET ARCHITECTURE

## 4.1. Layering

```text
src/
├── app/
│   ├── routes/
│   └── providers/
│
├── features/
│   ├── player/
│   ├── library/
│   ├── lyrics/
│   ├── upload/
│   ├── playlists/
│   ├── sharing/
│   ├── videos/
│   └── admin/
│
├── domain/
│   ├── track/
│   ├── album/
│   ├── artist/
│   ├── media/
│   ├── playlist/
│   └── user/
│
├── server/
│   ├── auth/
│   ├── library/
│   ├── media/
│   ├── storage/
│   ├── sharing/
│   └── admin/
│
├── repositories/
│   ├── metadata/
│   ├── media/
│   └── users/
│
├── services/
│   ├── spotify/
│   ├── lyrics/
│   └── analysis/
│
├── components/
│   └── ui/
│
└── styles/
```

Không nhất thiết phải dùng đúng tên thư mục này, nhưng **dependency direction phải giống tinh thần trên**.

## 4.2. Dependency rule

```text
UI
 ↓
Feature
 ↓
Domain
 ↓
Repository / Service
 ↓
Infrastructure
```

Không được:

```text
UI → S3 SDK
UI → Supabase service role
UI → raw Spotify API
UI → manifest file
```

---

# 5. DATA MODEL V2

## 5.1. Master domain

### `artists`

- id
- name
- normalized_name
- image_asset_id (nullable)
- created_at
- updated_at

### `albums`

- id
- artist_id
- title
- album_artist_id (nullable)
- release_year
- cover_asset_id
- release_type
- disc_count
- visibility
- created_at
- updated_at

### `tracks`

- id
- album_id (nullable)
- primary_artist_id
- title
- album_artist_id (nullable)
- track_number
- disc_number
- release_year
- genre
- composer
- copyright
- isrc
- visibility
- created_at
- updated_at

### `track_files`

- id
- track_id
- kind (`master` / future derivative)
- storage_key
- storage_provider
- extension
- container
- codec
- sample_rate
- bit_depth
- channels
- bitrate
- duration_seconds
- file_size_bytes
- sha256
- verified_at
- created_at

### `media_analysis`

- track_file_id / video_file_id
- parser_version
- detected_metadata
- analysis_status
- analyzed_at
- warnings

### `artwork_assets`

- id
- master_storage_key
- display_256_key
- display_512_key
- display_1024_key
- display_2048_key
- mime_type
- width
- height
- sha256
- created_at

### `lyrics_documents`

- id
- track_id
- source
- language
- kind (`plain` / `synced`)
- content
- offset_ms
- confidence
- verified
- version
- created_at
- updated_at

### `videos`

- id
- title
- artist_id
- album_id (nullable)
- visibility
- artwork_asset_id
- created_at
- updated_at

### `video_files`

- id
- video_id
- storage_key
- container
- codec
- resolution
- fps
- bitrate
- duration_seconds
- file_size_bytes
- sha256
- audio_codec
- hdr
- verified_at

## 5.2. User domain

### `profiles`

- user_id
- display_name
- avatar_url
- role (`member` / `owner`)
- created_at
- updated_at

### `user_favorites`

- user_id
- track_id
- created_at

Unique key:

```text
(user_id, track_id)
```

### `playlists`

- id
- user_id
- name
- description
- cover_asset_id (nullable)
- visibility (`private` / future `public`)
- created_at
- updated_at

### `playlist_tracks`

- playlist_id
- track_id
- position
- added_at

### `playback_history`

- user_id
- track_id
- started_at
- ended_at
- seconds_played
- completed

### `playback_state`

- user_id
- track_id
- position_seconds
- updated_at

### `user_preferences`

- theme
- volume
- crossfade
- replay_gain_mode
- default_view
- reduced_motion preference
- other UI settings

## 5.3. Platform domain

### `share_links`

- id
- token
- resource_type
- resource_id
- created_by
- expires_at
- revoked_at
- created_at

### `upload_jobs`

- id
- owner_id
- status
- stage
- progress
- total_bytes
- processed_bytes
- error_code
- created_at
- updated_at

### `audit_logs`

- id
- actor_user_id
- action
- resource_type
- resource_id
- payload
- created_at

### `backup_snapshots`

- id
- type
- storage_key
- created_at
- checksum

---

# 6. STORAGE ARCHITECTURE

## 6.1. S3 object layout

Recommended:

```text
audio/{trackId}/master.flac
audio/{trackId}/master.wav
video/{videoId}/master.mp4
video/{videoId}/master.mkv
artwork/{assetId}/master.jpg
artwork/{assetId}/256.webp
artwork/{assetId}/512.webp
artwork/{assetId}/1024.webp
artwork/{assetId}/2048.webp
subtitle/{videoId}/{subtitleId}.vtt
```

## 6.2. Rules

- DB owns identity.
- S3 owns bytes.
- Filename never becomes canonical metadata.
- Signed URLs are generated on demand.
- Playback URL lifetime should be short-lived.
- Do not persist signed URLs as canonical fields.
- Do not expose service-role credentials.

## 6.3. `library_manifest.json`

Transition plan:

### Phase A

Still readable.

### Phase B

Generated from DB as snapshot/recovery artifact.

### Phase C

Not used during normal runtime.

---

# 7. AUTHENTICATION & AUTHORIZATION

## 7.1. Authentication

Support:

- Email/password
- Google

Guest = anonymous session.

## 7.2. Authorization matrix

| Action | Guest | Member | Owner |
|---|---:|---:|---:|
| Browse public library | ✅ | ✅ | ✅ |
| Play | ✅ | ✅ | ✅ |
| Lyrics | ✅ | ✅ | ✅ |
| Share | ✅ | ✅ | ✅ |
| Favorite | ❌ persistent | ✅ | ✅ |
| Playlist | ❌ persistent | ✅ | ✅ |
| History | ❌ persistent | ✅ | ✅ |
| Upload master | ❌ | ❌ | ✅ |
| Edit master metadata | ❌ | ❌ | ✅ |
| Delete/Trash master | ❌ | ❌ | ✅ |
| Storage tools | ❌ | ❌ | ✅ |
| User management | ❌ | ❌ | ✅ |
| Backup/restore | ❌ | ❌ | ✅ |
| Audit logs | ❌ | ❌ | ✅ |

## 7.3. Mandatory security fixes

### MUST

- Remove fail-open auth.
- Remove hardcoded/default service-role secrets.
- Rotate any credentials that were ever exposed in source/repo/deployed environment.
- Remove `VITE_*` server secrets.
- Eliminate client-side admin decisions.
- Eliminate hardcoded Supabase storage-token-key checks.
- Keep service role key strictly server-side.
- Test every permission boundary.

---

# 8. MEDIA INGESTION / UPLOAD SYSTEM

## 8.1. Target workflow

```text
Select file(s)
  ↓
Local analysis
  ↓
Metadata extraction
  ↓
Artwork extraction
  ↓
Lyrics search
  ↓
Spotify identity match
  ↓
Duplicate detection
  ↓
Warnings / confidence
  ↓
Review Center
  ↓
Owner edits
  ↓
Upload session
  ↓
Transfer
  ↓
Server verification
  ↓
Commit canonical DB record
```

## 8.2. Batch upload requirements

- Multi-file selection.
- Controlled concurrency (start around 3–4 workers).
- Per-file progress.
- Overall progress.
- Retry.
- Cancel.
- Resume in future phase.
- Persistent upload state where feasible.
- No commit before validation.

## 8.3. Review Center

Each item should expose:

```text
Metadata       verified / warning / error
Artwork        verified / warning / error
Lyrics         synced / plain / missing
Spotify        match / uncertain / none
Duplicate      yes / no / uncertain
Integrity      pending / verified / failed
```

## 8.4. Bulk editing

Support:

- Set artist for selected files.
- Set album.
- Set year.
- Assign artwork.
- Apply Spotify identity.
- Choose lyric source.
- Reject item from batch.

## 8.5. Duplicate detection

Primary strategy:

```text
SHA-256 + file size + relevant media identity
```

On duplicate:

```text
Same master already exists.

[Use Existing]
[Upload Anyway]
[Cancel]
```

---

# 9. MEDIA ANALYSIS

## 9.1. Audio

Must detect actual:

- container
- codec
- sample rate
- bit depth
- channels
- duration
- bitrate
- file size
- metadata tags
- embedded artwork
- embedded lyrics

## 9.2. Video

Must detect actual:

- container
- video codec
- audio codec
- resolution
- FPS
- bitrate
- duration
- HDR
- subtitle streams
- audio streams

## 9.3. Rule

Never fallback to fake values like:

```text
24-bit
96kHz
4K
H.264
12.5 Mbps
```

unless actual analysis confirms them.

If unknown:

```text
Unknown
```

---

# 10. LYRICS SYSTEM

## 10.1. Status

Lyrics is a **core product pillar**, not a secondary modal.

## 10.2. Sources

Support pluggable providers such as:

- Embedded lyrics
- LRCLIB
- Lyrics.ovh
- Community source(s)
- Manual input
- Imported source

Every lyric document must keep `source`.

## 10.3. Synced lyrics

Model:

```text
lineId
startMs
text
```

## 10.4. Offset

Global offset feature:

```text
lyrics offset = -1200ms
```

must shift display timing without mutating original timestamps.

## 10.5. Timeline editor

Desired UX:

```text
+----------------------+-------------------------+
| Waveform             | Lyrics                  |
|                      |                         |
| ------●-----------   | [00:12.20] line        |
|        ^ playhead     | [00:15.84] line        |
|                      | [00:19.31] line        |
| ▶ 00:21.32           |                         |
+----------------------+-------------------------+
```

Must support:

- Play/pause.
- Current line highlight.
- Tap to seek line.
- Drag timestamp marker.
- Nudge ±10/50/100ms.
- Global offset.
- Preview.
- Save version.
- Reset.

## 10.6. Explicitly remove

Vietnamese automatic lyric content correction.

Allowed cleanup only:

- whitespace normalization
- line-break cleanup
- malformed timestamp detection
- sorting timestamps
- empty-line cleanup
- duplicate timestamp warning

---

# 11. PLAYER V2

## 11.1. Architecture

Separate:

```text
Player Store
Queue Store
Audio Engine
Lyrics Clock
Playback Analytics
```

React is consumer, not the audio engine.

## 11.2. AudioEngine API

Conceptually:

```ts
load(track)
play()
pause()
seek(seconds)
setVolume(value)
preload(track)
crossfadeTo(track, seconds)
stop()
```

## 11.3. Required behavior

- Play/pause.
- Seek.
- Previous.
- Next.
- Shuffle.
- Repeat off/all/one.
- Queue reorder.
- Crossfade 0–10 sec.
- Gapless best-effort.
- ReplayGain.
- Persistent queue optional.
- Continue listening.
- Recent history.

## 11.4. Critical fix

Fix current `prev()` semantics so:

- If current playback position > threshold → restart current track.
- Else → previous track.

This must be covered by automated tests.

## 11.5. ReplayGain

Modes:

- Off
- Track Gain
- Album Gain

Recommended defaults:

- Album context → Album Gain.
- Mixed playlist → Track Gain.

No mutation of master file.

## 11.6. Equalizer

Optional later feature.

Default:

```text
OFF
```

Do not compromise neutral playback by default.

## 11.7. Bit-perfect statement

Web:

> Maximum-quality native/lossless playback possible within browser audio constraints.

Desktop future:

- WASAPI Exclusive
- ASIO if practical
- Native audio pipeline

---

# 12. PLAYLIST / FAVORITES / HISTORY

## 12.1. Favorites

Instant optimistic UI.

On failure:

- Rollback.
- Show retryable error.

## 12.2. Playlists

Support:

- Create
- Rename
- Delete
- Reorder
- Add/remove
- Cover
- Description
- Private by default

Future:

- Share playlist
- Public playlist

## 12.3. History

Record meaningful listening events, not every `timeupdate`.

Use debounced/batched writes.

## 12.4. Continue Listening

Persist position for Member.

Resume where left off.

---

# 13. SHARING

## 13.1. Public share URL

Use compact professional URLs:

```text
/s/{token}
```

## 13.2. Share page

Must include:

- Artwork
- Track title
- Artist
- Album
- Duckroom branding
- Play CTA
- Open Graph metadata

## 13.3. Security

- Token revocable.
- Optional expiry.
- Does not expose raw S3 key.
- Does not expose service credentials.
- Share page can enforce resource visibility.

## 13.4. Social previews

Target:

- Discord
- Facebook
- Zalo
- Telegram
- X/Twitter
- Other OpenGraph-compatible platforms

TikTok preview behavior must be treated as platform-dependent rather than promised.

---

# 14. SPOTIFY INTEGRATION

## 14.1. Positioning

Spotify is an **external metadata / identity bridge**.

Duckroom remains canonical for:

- audio file
- video
- lyrics
- artwork copy
- internal metadata
- playback

## 14.2. Import flow

```text
Paste Spotify URL
  ↓
Identify track / album / playlist
  ↓
Fetch supported metadata
  ↓
Match local file(s)
  ↓
Show confidence
  ↓
Owner confirms
  ↓
Persist external identity
```

## 14.3. External identity model

Avoid Spotify-specific columns everywhere.

Prefer:

```text
external_identities
├── provider
├── external_id
├── resource_type
├── resource_id
└── url
```

Spotify becomes first provider.

Future providers can be added without schema redesign.

## 14.4. Critical constraint

If Spotify is unavailable:

> Duckroom must still play normally.

No runtime dependency on Spotify for core playback.

---

# 15. VIDEO / MV ARCHIVE

## 15.1. Formats

Support storage for:

- MP4
- MKV
- WebM
- MOV

Playback support is browser/container/codec dependent.

## 15.2. Initial streaming strategy

Do not build HLS/DASH immediately.

Use:

- private object
- short-lived playback URL
- HTTP Range support
- native HTML5 video

Later:

- HLS/DASH only if traffic/compatibility justifies transcoding infrastructure.

## 15.3. Subtitle system

Target:

- WebVTT
- SRT
- ASS
- Embedded tracks where browser permits

UX:

```text
CC
├── Off
├── Vietnamese
├── English
└── ...
```

Prefer sidecar subtitles over hardsub by default.

---

# 16. ARTWORK SYSTEM

## 16.1. Principle

Artwork is part of artist identity and one of Duckroom’s core visual assets.

## 16.2. Storage

Keep original master.

Generate web derivatives:

- 256
- 512
- 1024
- 2048

## 16.3. UI

Use progressive loading:

```text
placeholder
→ low-res
→ final
```

Avoid shipping 3000–5000px images into tiny thumbnails.

---

# 17. USER EXPERIENCE / VISUAL SYSTEM

## 17.1. Design direction

Target:

- Modern
- Strong
- Chill
- Cinematic
- Personal
- Quiet luxury
- Audio-studio character
- Distinctive, not clone-like

## 17.2. Brand DNA

Primary visual anchors:

1. Duck icon.
2. Waveform.
3. Artwork.
4. Music-centric typography.

Duck should feel like a refined mascot, not a cartoon UI theme.

## 17.3. Themes

Dark = primary.

Light = first-class, not inverted dark mode.

Theme switch must be smooth but lightweight.

---

# 18. MOTION SYSTEM

## 18.1. Motion tokens

Create shared:

- `duration-instant`
- `duration-fast`
- `duration-normal`
- `duration-slow`
- `ease-standard`
- `ease-emphasized`
- `ease-exit`
- `spring-soft`
- `spring-snappy`
- `spring-heavy`

## 18.2. Timing guidance

- Micro interaction: ~80–180ms
- UI transition: ~180–280ms
- Spatial transition: ~250–450ms
- Hero/immersive: ~400–800ms

These are starting ranges, not rigid dogma.

## 18.3. Motion rule

Every animation must answer at least one:

- What changed?
- Where did it come from?
- Where is it going?
- What should the user focus on?

If none apply, remove the animation.

## 18.4. Performance rules

Avoid unnecessary animation of:

- huge blurs
- expensive box shadows
- layout-triggering properties
- full-screen filters

Prefer transform/opacity where appropriate.

---

# 19. PERFORMANCE ENGINEERING

## 19.1. Primary goal

No noticeable jank in:

- player
- lyrics scrolling
- queue reorder
- artwork transition
- theme switching
- sidebar transitions
- modal transitions

## 19.2. Player isolation

Audio engine must be independent of frequent React/UI renders.

## 19.3. Visualizer

- Pause when hidden/offscreen.
- Limit update work.
- Cache dimensions.
- Avoid unnecessary resize calculations.
- Reduce workload on mobile/low-power devices.

## 19.4. Lists

Under current scale (<1000 tracks), virtualization is optional.

If library grows materially:

- virtualized track list
- paginated DB queries
- incremental hydration

## 19.5. Images

Responsive derivatives + lazy loading + preloading only for likely next/visible artwork.

---

# 20. ERROR HANDLING

## 20.1. Anti-pattern to remove

Never do:

```text
storage failed → return []
```

or:

```text
analysis failed → invent defaults
```

## 20.2. Error model

Use structured application errors:

```text
code
message
userMessage
retryable
severity
cause
```

Example codes:

- AUTH_EXPIRED
- FORBIDDEN
- STORAGE_TIMEOUT
- STORAGE_WRITE_FAILED
- MEDIA_ANALYSIS_FAILED
- DUPLICATE_FILE
- LYRICS_PROVIDER_TIMEOUT
- MANIFEST_CORRUPT
- INVALID_MEDIA

## 20.3. UI behavior

Every error should define:

- What happened?
- Can user retry?
- Did data mutate?
- Is rollback needed?
- What is safe to do next?

---

# 21. SECURITY HARDENING

## 21.1. Secrets

Remove from source:

- service-role key defaults
- S3 access key defaults
- S3 secret defaults
- any secret-like `VITE_*` fields

## 21.2. Credential hygiene

Assume any credential that was ever committed to a public repository or deployed client bundle is compromised.

Actions:

1. Rotate.
2. Revoke old secret.
3. Issue new secret.
4. Update Vercel / infrastructure.
5. Audit source/build output.

## 21.3. Server-only boundary

Service role and S3 secret keys may only exist in server runtime.

## 21.4. Authorization

Enforce on server for every mutation.

UI hiding is not authorization.

## 21.5. Storage path validation

Keep current strong validation and add:

- ownership check
- object existence checks
- maximum object size
- allowed MIME types
- optional magic-byte verification

---

# 22. DATABASE / RLS STRATEGY

## 22.1. Public master content

Publicly readable only according to `visibility` policy.

## 22.2. User data

Every personal row must enforce:

```text
auth.uid() = user_id
```

or equivalent secure server-side policy.

## 22.3. Owner mutations

Only `role = owner` can mutate master library.

## 22.4. Do not bypass RLS casually

Use service role only where server-authoritative work truly requires it, and still perform explicit authorization checks first.

---

# 23. OBSERVABILITY / AUDIT

## 23.1. Error reporting

Recommend integrating a proper error-monitoring system after core stabilization.

## 23.2. Audit events

Record:

- upload
- edit metadata
- edit lyrics
- artwork replacement
- delete / trash
- restore
- user role change
- share creation
- share revocation
- backup
- restore

## 23.3. Health Center

Owner dashboard should surface:

```text
Database       ✓
Storage        ✓
Auth           ✓
Orphans        ⚠
Missing media  ⚠
Duplicates     ⚠
Failed jobs    ⚠
```

---

# 24. BACKUP / RECOVERY

## 24.1. Objective

Prevent catastrophic library loss without unnecessarily duplicating every master file.

## 24.2. Layers

### Layer 1

Private storage + safe destructive policy.

### Layer 2

Database backup / snapshots.

### Layer 3

Periodic metadata manifest snapshot.

### Layer 4 (optional)

Secondary/cold copy of master media.

## 24.3. Trash

Prefer soft delete:

```text
active
→ trash
→ retention period
→ permanent delete
```

Owner can restore.

## 24.4. Integrity scanner

Detect:

- DB row missing S3 object
- S3 object without DB row
- checksum mismatch
- duplicate master
- missing artwork
- broken lyric relation
- broken album relation

---

# 25. ADMIN / OWNER CONSOLE

## 25.1. Modules

```text
Overview
Library
Uploads
Users
Storage
Duplicates
Orphans
Lyrics
Videos
Shares
Activity
Backups
Health
Settings
```

## 25.2. Dashboard metrics

At minimum:

- Total tracks
- Total albums
- Total videos
- Storage used
- Failed uploads
- Orphans
- Duplicates
- Recent activity
- Last backup

## 25.3. Do not build generic CRUD first

Build around **operational health and control**.

---

# 26. TESTING STRATEGY

## 26.1. Unit tests

Critical domains:

- player state machine
- queue
- shuffle
- repeat
- previous/next semantics
- LRC parsing
- lyrics offset
- lyrics normalization
- storage-key validation
- permission rules
- metadata schema
- duplicate detection

## 26.2. Integration tests

- Auth + role policy
- User favorites
- Playlist CRUD
- Upload commit
- Upload failure rollback
- Storage presign authorization
- Share creation / revocation
- DB ↔ storage integrity checks

## 26.3. E2E

### Guest

- Browse
- Play
- Lyrics
- Share
- Favorite triggers auth gate

### Member

- Login
- Favorite
- Playlist
- History
- Continue listening
- Preferences

### Owner

- Upload
- Review
- Commit
- Edit
- Trash
- Restore
- Storage scan
- User management

## 26.4. Performance verification

Use browser performance traces to verify:

- no major long task during player interaction
- no obvious render storm during lyrics playback
- no UI-induced playback stalls
- queue drag remains responsive
- visualizer does not dominate CPU/GPU

---

# 27. CI / RELEASE GATES

Every production merge should require:

```text
[ ] Typecheck passes
[ ] Lint passes
[ ] Unit tests pass
[ ] Integration tests pass
[ ] E2E smoke tests pass
[ ] Build passes
[ ] No secret scanning failure
[ ] Dependency audit acceptable
[ ] Production environment variables present
```

No “it works on my machine” merge.

---

# 28. FILE / MODULE MIGRATION MAP

## 28.1. High-priority existing modules

### `src/lib/auth.server.ts`

Action:

**REWRITE / HARDEN**

Goals:

- fail-closed
- roles
- explicit authorization
- server-only
- no fallback admin

### `src/lib/supabase.ts`

Action:

**REWRITE**

Goals:

- public client config only
- server admin client isolated
- no hardcoded secrets

### `src/lib/s3-functions.ts`

Action:

**REFACTOR / REDESIGN**

Goals:

- domain-level API
- storage adapter boundary
- short-lived playback URLs
- size/MIME validation
- structured errors

### `src/data/library.ts`

Action:

**MAJOR REFACTOR / RETIRE AS DATABASE**

Goals:

- remove mutable global master arrays
- remove fuzzy relation logic
- move canonical data to DB
- use manifest only for migration/recovery

### `src/lib/player.tsx`

Action:

**MAJOR REFACTOR / SPLIT**

Goals:

- AudioEngine
- PlayerStore
- QueueStore
- LyricsClock
- Playback analytics

### `src/lib/upload-store.ts`

Action:

**REWRITE WORKFLOW**

Goals:

- analyze
- review
- commit
- retry
- progress
- duplicate detection
- safe failures

### `src/lib/metadata.ts`

Action:

**REFactor / extend**

Goals:

- local preview parser
- actual analysis
- no fake defaults
- explicit unknown state

### `src/lib/lyrics-search.ts`

Action:

**REFactor into provider architecture**

Goals:

- provider abstraction
- source tracking
- confidence
- fallback

### `src/lib/lyrics-formatter.ts`

Action:

**KEEP / CLEAN**

Goals:

- preserve content
- formatting utilities only

### `src/lib/player-clock.ts`

Action:

**KEEP / HARDEN**

Goals:

- precise clock distribution
- low render churn

### `src/components/player/*`

Action:

**KEEP VISUAL DNA / REFACTOR DATA ACCESS**

Goals:

- components consume selectors/hooks
- no low-level storage access

---

# 29. NEW MODULES TO ADD

Likely new modules:

```text
src/server/auth/authorization.ts
src/server/library/*.ts
src/server/uploads/*.ts
src/server/playback/*.ts
src/server/shares/*.ts
src/server/admin/*.ts

src/domain/media/*.ts
src/domain/player/*.ts
src/domain/library/*.ts
src/domain/user-library/*.ts
src/domain/lyrics/*.ts

src/services/spotify/*.ts
src/services/lyrics/*.ts
src/services/media-analysis/*.ts

src/repositories/*.ts

src/features/upload-review/*
src/features/playlists/*
src/features/favorites/*
src/features/history/*
src/features/sharing/*
src/features/admin/*
```

Exact filenames may change after repository-level implementation.

---

# 30. PHASED EXECUTION PLAN

# PHASE 0 — FREEZE & BASELINE

## Objective

Stop architecture drift and establish evidence.

## Actions

- Freeze non-essential feature additions.
- Capture current build/lint/typecheck status.
- Document current env vars.
- Inventory secret-like literals.
- Inventory all storage operations.
- Inventory all DB reads/writes.
- Inventory all localStorage keys.
- Inventory all player transitions.
- Inventory all upload states.

## Verify

Produce:

- architecture map
- secret inventory
- data flow map
- test baseline
- performance baseline

## Exit criteria

No unknown core write path remains.

---

# PHASE 1 — SECURITY P0

## Objective

Make the system safe enough to continue.

## Actions

1. Remove hardcoded credentials.
2. Rotate any exposed/previously exposed secrets.
3. Split client/server Supabase clients.
4. Split client/server S3 config.
5. Remove fail-open fallback.
6. Implement Guest / Member / Owner.
7. Enforce owner server-side.
8. Remove localStorage auth-key hacks.
9. Add authorization tests.
10. Shorten playback URL policy.

## Verify

Manual security matrix + automated tests:

```text
Guest → upload           = 403
Member → upload          = 403
Member → delete master   = 403
Owner → upload           = 200
Owner → delete           = allowed
Missing secret           = fail closed
```

## Exit criteria

No critical security issue remains open.

---

# PHASE 2 — DATA FOUNDATION

## Objective

Establish canonical DB model.

## Actions

- Create schema v2.
- Add artists/albums/tracks/files/artworks/lyrics/videos.
- Add user library tables.
- Add share/audit/upload tables.
- Add RLS.
- Create repository layer.
- Create migrations.

## Migration

```text
Current manifest
    ↓
parse
    ↓
validate
    ↓
insert DB
    ↓
verify counts
    ↓
mark migration complete
```

## Verify

- Track count matches.
- Album relations valid.
- Video count matches.
- Storage keys valid.
- No duplicate canonical IDs.
- Sample playback from DB works.

## Exit criteria

DB can reconstruct all application metadata without manifest.

---

# PHASE 3 — STORAGE FOUNDATION

## Objective

Make S3 a binary store, not a database.

## Actions

- Standardize object keys.
- Preserve master files.
- Add artwork derivative structure.
- Implement playback URL service.
- Implement upload URL service.
- Add object validation.
- Add orphan scan.
- Keep manifest as snapshot only.

## Verify

- No signed URL stored as canonical field.
- Reopening app does not require manifest.
- Missing manifest does not break library.
- Storage scan identifies orphans.

---

# PHASE 4 — MEDIA ANALYSIS + UPLOAD V2

## Objective

Turn upload into an ingestion pipeline.

## Actions

- Actual audio analysis.
- Actual video analysis.
- Artwork extraction.
- Lyrics extraction.
- SHA-256/hash.
- Duplicate detection.
- Confidence model.
- Review Center.
- Bulk edits.
- Controlled concurrency.
- Retry.
- Safe commit.

## Verify

Test with:

- FLAC 16/44.1
- FLAC 24/96
- WAV
- ALAC
- MP3
- AAC/M4A
- MP4
- MKV
- WebM
- MOV
- malformed file
- duplicate file
- network interruption

## Exit criteria

No fake quality metadata is ever surfaced.

---

# PHASE 5 — PLAYER V2

## Objective

Make playback reliable and independent from UI render pressure.

## Actions

- Split AudioEngine.
- Fix previous/next semantics.
- Formalize queue state.
- Crossfade.
- Gapless best effort.
- ReplayGain.
- Continue listening.
- Playback history.
- Persistent player preferences.

## Verify

Automated player state tests + manual 60 FPS performance trace.

Scenarios:

- Play.
- Pause.
- Seek.
- Next.
- Previous under 4 sec.
- Previous over 4 sec.
- Shuffle.
- Repeat one.
- Repeat all.
- Queue reorder.
- Song ends during crossfade.
- Network hiccup.
- Tab hidden.
- Tab restored.

---

# PHASE 6 — LYRICS V2

## Objective

Make lyrics a signature product feature.

## Actions

- Provider abstraction.
- Source tracking.
- Synced model.
- Offset.
- Timeline editor.
- Versioning.
- Confidence.
- Community source support.
- Live preview.

## Verify

Use real tracks with:

- no lyrics
- plain lyrics
- synced lyrics
- wrong offset
- malformed LRC
- multiple provider matches

## Exit criteria

Owner can fix timing visually without editing raw timestamps manually.

---

# PHASE 7 — MEMBER EXPERIENCE

## Objective

Introduce personal library.

## Actions

- Favorites.
- Playlists.
- History.
- Continue listening.
- User settings.
- Custom library sections.
- Optimistic updates.

## Verify

Guest cannot persist.
Member sees only own data.
User A cannot access User B’s playlists/favorites.

---

# PHASE 8 — SHARING

## Objective

Create polished share experience.

## Actions

- Share token model.
- Short URL.
- Share page.
- OpenGraph image/title/artist.
- Revocation.
- Optional expiry.

## Verify

Test preview on major supported platforms where practical.

---

# PHASE 9 — SPOTIFY BRIDGE

## Objective

Make Spotify useful without making Duckroom dependent on it.

## Actions

- External identity model.
- Track import.
- Album import.
- Playlist import mapping.
- Local-file matching.
- Match confidence.
- Owner confirmation.
- Fail gracefully if Spotify unavailable.

## Verify

Spotify unavailable must not affect Duckroom playback.

---

# PHASE 10 — OWNER CONSOLE / HEALTH

## Objective

Make future growth manageable.

## Actions

- Overview.
- Upload queue.
- Library management.
- User management.
- Storage health.
- Duplicate scan.
- Orphan scan.
- Audit logs.
- Backups.
- Restore.

## Verify

Owner can diagnose common failure modes without opening the database manually.

---

# PHASE 11 — MOTION / VISUAL MASTERING

## Objective

Make Duckroom feel premium and uniquely Duckroom.

## Actions

- Motion token system.
- Route transitions.
- Theme transition.
- Player transitions.
- Lyrics choreography.
- Queue interactions.
- Artwork transitions.
- Loading skeletons.
- Mobile gestures.
- Reduced-motion variants.

## Verification methodology

Do not judge by feeling only.

Use:

- Chrome Performance.
- React Profiler.
- Frame rendering stats.
- CPU throttling.
- Network throttling.
- Low-power/mobile device testing.

## Exit criteria

No obvious jank in core interaction flows under realistic data.

---

# 31. PERFORMANCE QA MATRIX

Test at minimum:

| Scenario | Desktop | Mobile | Slow network | Low CPU |
|---|---:|---:|---:|---:|
| Browse library | ✅ | ✅ | ✅ | ✅ |
| Open album | ✅ | ✅ | ✅ | ✅ |
| Start playback | ✅ | ✅ | ✅ | ✅ |
| Lyrics scrolling | ✅ | ✅ | ✅ | ✅ |
| Queue reorder | ✅ | ✅ | N/A | ✅ |
| Theme switching | ✅ | ✅ | N/A | ✅ |
| Upload review | ✅ | ✅ | ✅ | ✅ |
| Visualizer | ✅ | ✅ | N/A | ✅ |
| Share page | ✅ | ✅ | ✅ | ✅ |

---

# 32. SECURITY QA MATRIX

Test:

```text
Guest → favorites       FAIL / auth gate
Guest → playlist        FAIL / auth gate
Guest → upload          403
Guest → admin           403
Member → owner action   403
Member → own favorite   allowed
Member → other data     403 / empty by policy
Owner → owner action    allowed
Expired session         rejected
Invalid token           rejected
Storage traversal       rejected
Oversized upload        rejected
Wrong MIME              rejected
```

---

# 33. DATA INTEGRITY QA MATRIX

Check:

```text
DB track exists + file exists      ✓
DB track missing file              ⚠
S3 file missing DB row             ⚠
Checksum matches                   ✓
Checksum mismatch                  ⚠
Artwork exists                     ✓
Artwork missing                    ⚠
Lyrics source valid                ✓
Album relation valid               ✓
Playlist order stable              ✓
Share link resolves                ✓
```

---

# 34. RELEASE STRATEGY

## Environment

- Local
- Preview
- Production

## Staging principle

Do not test migration directly on production data first.

Use a sanitized/copy environment.

## Rollout

```text
Migration
 ↓
Shadow verification
 ↓
Read path switch
 ↓
Write path switch
 ↓
Monitor
 ↓
Retire old path
```

---

# 35. ROLLBACK STRATEGY

Every major phase must define:

- DB migration rollback or forward-fix plan.
- Feature flag.
- Old/new read compatibility when feasible.
- Storage key compatibility.
- Snapshot before migration.

Never perform irreversible migration without a restore point.

---

# 36. FEATURE FLAGS

Recommended for high-risk migrations:

```text
DUCKROOM_DB_CANONICAL
DUCKROOM_NEW_PLAYER
DUCKROOM_NEW_UPLOAD
DUCKROOM_SPOTIFY_IMPORT
DUCKROOM_NEW_SHARING
DUCKROOM_NEW_LYRICS_EDITOR
```

These can be temporary and removed after stabilization.

---

# 37. DOCUMENTATION TO REWRITE

README must accurately describe:

- guest/member/owner model
- storage model
- no exposed secrets
- actual media support
- actual browser limitations
- actual playback capabilities
- lyrics sources
- share links
- Spotify role

Remove unsupported claims like:

- guaranteed 0ms latency
- guaranteed 100% gapless
- guaranteed bit-perfect browser playback
- fake fixed Hi-Res metadata

---

# 38. DEPRECATED / REMOVE LIST

Eventually remove:

- `library_manifest` runtime ownership
- mutable global track arrays
- fuzzy album matching for canonical relations
- auth localStorage key hardcoding
- fail-open auth
- secret fallbacks
- fake media metadata defaults
- Vietnamese lyric auto-correction
- generic “failure = empty list” handlers
- permanent signed URL persistence

---

# 39. WHAT NOT TO BUILD YET

Do NOT prioritize:

- Recommendation engine
- AI music recommendation
- Microservices
- Kafka
- Redis cluster
- Vector search
- HLS transcoding
- DRM
- 8K optimization
- Social feed
- Public creator marketplace
- Complex analytics platform

These are distractions at current scale.

---

# 40. FUTURE, NOT NOW

After core is stable:

- Tauri/Desktop app.
- Native/bit-perfect output path.
- WASAPI Exclusive.
- Advanced EQ.
- Advanced audio analysis.
- HLS for high-traffic video.
- Multi-provider music identity.
- Optional public playlists.

---

# 41. DEFINITION OF DONE — MASTER CHECKLIST

## Architecture

- [ ] DB canonical
- [ ] S3 binary-only
- [ ] Server boundary clean
- [ ] Repository/service boundaries clean

## Security

- [ ] No hardcoded secrets
- [ ] Secrets rotated where necessary
- [ ] Fail-closed auth
- [ ] Guest/Member/Owner enforced
- [ ] Owner actions server protected
- [ ] Storage access validated

## Data integrity

- [ ] Actual media metadata
- [ ] SHA-256
- [ ] Duplicate detection
- [ ] Orphan scanner
- [ ] Trash/restore
- [ ] Backup snapshots

## Upload

- [ ] Batch upload
- [ ] Review center
- [ ] Progress
- [ ] Retry
- [ ] Controlled concurrency
- [ ] Safe commit

## Player

- [ ] Audio engine separated
- [ ] Previous/next correct
- [ ] Queue stable
- [ ] Crossfade 0–10s
- [ ] ReplayGain
- [ ] Continue listening
- [ ] History

## Lyrics

- [ ] Multi-provider
- [ ] Synced lyrics
- [ ] Offset
- [ ] Timeline editing
- [ ] Preview
- [ ] Versioning
- [ ] No automatic lyric content mutation

## Member

- [ ] Favorites
- [ ] Playlists
- [ ] History
- [ ] Preferences
- [ ] Custom library

## Sharing

- [ ] Short URLs
- [ ] Revocable
- [ ] OpenGraph preview
- [ ] No raw storage URL exposure

## Spotify

- [ ] External identity model
- [ ] Import
- [ ] Match
- [ ] Confirm
- [ ] Graceful fallback

## Video

- [ ] MP4
- [ ] MKV storage
- [ ] WebM
- [ ] MOV
- [ ] Range playback
- [ ] Subtitle support

## UI / Motion

- [ ] Dark mode polished
- [ ] Light mode polished
- [ ] Motion tokens
- [ ] Reduced motion
- [ ] No obvious jank
- [ ] Mobile UX
- [ ] Keyboard accessibility

## Operations

- [ ] Owner dashboard
- [ ] Health center
- [ ] Audit logs
- [ ] Backup
- [ ] Restore
- [ ] CI gates

---

# 42. PRIORITY MAP

## P0 — BLOCKING

1. Secrets / security.
2. Auth / roles.
3. Server-only boundary.
4. Canonical database.
5. Real media metadata.
6. Storage ownership.
7. Remove fail-open / fake defaults.

## P1 — CORE EXPERIENCE

8. Player engine.
9. Upload pipeline.
10. Lyrics V2.
11. Favorites.
12. Playlists.
13. History.
14. Data integrity.

## P2 — PRODUCT POWER

15. Sharing.
16. Spotify bridge.
17. Owner health console.
18. Backup / restore.
19. Duplicate / orphan tools.
20. Subtitle UX.

## P3 — POLISH / FUTURE

21. Motion mastering.
22. Desktop app.
23. Native audio.
24. Advanced EQ.
25. Advanced video streaming.

---

# 43. RECOMMENDED IMPLEMENTATION ORDER BY FILE IMPACT

```text
1. auth.server.ts
2. supabase.ts / server Supabase boundary
3. s3-functions.ts
4. database schema + migrations
5. repositories
6. library.ts migration away from mutable state
7. metadata.ts
8. upload-store.ts / upload feature
9. player.tsx split into engine/store
10. lyrics-search.ts / lyrics editor
11. member library data layer
12. sharing layer
13. admin layer
14. motion/performance pass
15. documentation
16. test hardening
```

Do not interpret this as “one file at a time”. Several items should be developed behind compatible interfaces/feature flags.

---

# 44. SENIOR REVIEW RULES FOR EVERY CHANGE

Before accepting a PR/change, ask:

### Product

- Does this improve the intended UX?
- Is the behavior predictable?

### Domain

- Who owns this data?
- What is canonical?

### Security

- Who is allowed to do this?
- Can the server enforce it independently of UI?

### Reliability

- What happens if the network fails halfway?
- Can the user retry?
- Could data become orphaned?

### Performance

- How many renders?
- How much memory?
- Does this affect player playback?

### Accessibility

- Keyboard?
- Reduced motion?
- Screen reader semantics?

### Maintainability

- Does this leak infrastructure details into UI?
- Does it increase coupling?
- Is there a test for the risky behavior?

---

# 45. FINAL TARGET

Duckroom V2 should feel like:

> **A calm, powerful, personal music system where the user owns the experience, the library remains trustworthy, the audio stays faithful, lyrics feel alive, and every interaction feels intentionally designed.**

The product should not feel like a collection of features.

It should feel like **one coherent machine**.

The duck is the personality.

The waveform is the signature.

The artwork is the emotion.

The lyrics are the connection.

The player is the engine.

The archive is the trust layer.

The member library is the personal space.

The owner console is the control room.

And the architecture underneath must be strong enough that future features do not destabilize any of those pieces.

---

# 46. IMMEDIATE NEXT ACTIONS

When implementation begins, the first concrete work package should be:

### WP-01 — Security & Boundary Reset

Deliverables:

- Clean server/client env separation.
- Secret removal/rotation checklist.
- Guest/Member/Owner authorization service.
- Server-only service-role usage.
- Playback access policy.
- Security test matrix.

### WP-02 — Canonical Data Foundation

Deliverables:

- DB migrations.
- Core repositories.
- Master library schema.
- User library schema.
- Manifest migration tooling.
- Integrity verification command/tool.

### WP-03 — Media Ingestion Foundation

Deliverables:

- Actual media analysis.
- Upload session model.
- Review Center.
- SHA-256.
- Duplicate detection.
- Safe commit.

Only after WP-01 + WP-02 are stable should the project start adding large new product features.

---

# 47. FINAL SENIOR LEAD DECISION

### KEEP

- Duckroom visual identity
- waveform
- player UX concept
- lyrics concept
- artwork system concept
- queue interactions
- Motion foundation
- existing stack direction

### REFACTOR HEAVILY

- auth
- storage
- database
- library state
- upload
- player core
- lyrics architecture
- error handling

### REMOVE

- fail-open admin fallback
- secret fallbacks
- fake media metadata
- fuzzy canonical album matching
- automatic Vietnamese lyric content correction
- runtime dependency on `library_manifest.json`
- long-lived canonical signed URLs

### ADD

- Guest/Member/Owner
- personal library
- favorites
- playlists
- history
- share links
- Spotify identity/import
- real media analysis
- duplicate detection
- checksum
- upload review center
- trash/restore
- audit logs
- health center
- backup/restore
- subtitle management

### END STATE

**Duckroom V2 = Spotify-like experience + Duckroom-owned music archive + lyrics-first workflow + lossless-first playback + professional personal library + trustworthy architecture.**

---

> **This document is the master plan.**
> Implementation should follow it in phases, with verification at every boundary. Do not add feature scope faster than the architecture can safely absorb it.
