# DUCKROOM V2 — STRICT REMEDIATION / ENGINEERING MANDATE FOR GEMINI
## Version 1.0 — 2026-08-19
## Audience: Gemini 3.7 Flash (High) or any coding agent working directly on the Duckroom repository

> **THIS IS AN EXECUTION MANDATE, NOT A SUGGESTION LIST.**
>
> Do not mark a phase complete because a file, function, route, table, component, or UI exists.
> A requirement is complete only when the underlying invariant is actually satisfied, the failure path is handled, the authorization boundary is correct, persistence is correct, and there is concrete verification evidence.
>
> **Never report “100%”, “production-ready”, “zero issues”, or similar claims unless you have evidence.**
>
> If implementation and documentation disagree, **trust the code/database/runtime behavior first, then update the documentation**.
>
> If you cannot verify something, mark it `UNVERIFIED`, not `DONE`.

---

# 0. MISSION

Your job is to take the current Duckroom repository and bring it to the **actual** target architecture defined by:

- `DUCKROOM_MASTER_PLAN.md`
- current Duckroom product decisions
- current source code
- current Supabase schema/migrations
- current S3/Pikamc architecture

The goal is **not** to add superficial features.

The goal is to make Duckroom:

> **A Spotify-like personal music platform with Duckroom-owned masters, data, lyrics, artwork, playlists, favorites, history, sharing, and a highly polished player experience — while remaining secure, canonical, auditable, recoverable, and maintainable.**

---

# 1. NON-NEGOTIABLE PRODUCT PRINCIPLES

## 1.1 Product identity

Duckroom is:

- modern
- strong
- chill
- cinematic
- personal
- music-first
- visually distinctive
- smooth
- high quality

Duckroom is **NOT**:

- a Spotify clone
- a generic CRUD dashboard
- a raw S3 browser
- a file manager
- a cartoon app
- an “over-animated” landing page
- a fake Hi-Res marketing layer

The Duckroom visual DNA must preserve:

- the duck icon/mascot
- waveform identity
- album artwork prominence
- restrained but high-quality motion

---

# 2. USER MODEL

## 2.1 Guest

Guest can:

- browse public library
- play public tracks
- view public albums/videos
- view lyrics
- use temporary queue/player state
- share allowed public content

Guest cannot:

- persist favorites
- persist playlists
- modify master metadata
- upload
- delete
- mutate S3
- access private/member/owner content

When Guest clicks Favorite/Playlist/etc.:

- show a polished authentication gate
- do NOT silently fail
- do NOT expose unauthorized API behavior

---

## 2.2 Member

Any authenticated non-owner account is a Member.

Member can:

- play public/member-visible content
- create/manage personal favorites
- create/manage personal playlists
- view personal history
- persist playback state
- customize personal library
- share content where policy permits
- manage personal settings

Member CANNOT:

- upload masters
- modify master library metadata
- delete master media
- write to arbitrary S3 locations
- delete arbitrary S3 objects
- overwrite recovery snapshots
- manage users
- access Owner controls

---

## 2.3 Owner

Owner is the only role allowed to:

- upload master media
- edit master metadata
- edit master lyrics
- edit artwork assets
- delete/restore master records
- create/modify storage objects through privileged workflows
- manage library integrity
- run orphan scans
- run storage cleanup
- manage backups/snapshots
- restore snapshots
- review audit logs
- manage users/roles
- use Owner control room

Owner identity must be server-enforced.

---

# 3. HARD SECURITY RULES

## 3.1 Fail closed

Never:

```text
missing env → admin
missing key → privileged action
unknown role → owner
storage error → raw public URL
```

Correct behavior:

```text
missing privileged configuration → fail closed
unknown role → deny
authorization failure → 403
storage auth failure → fail
```

---

# 3.2 Server-only secrets

Never expose:

- S3 secret key
- Supabase service-role/secret key
- Spotify client secret
- any future server credential

through:

- `VITE_*`
- client-side modules
- browser bundles
- public runtime configuration

`VITE_*` is allowed only for genuinely public browser-safe config.

---

# 3.3 S3 authorization

This is currently a P0.

The following operations MUST be Owner-only unless explicitly designed otherwise:

- presigned upload URL
- S3 delete
- manifest write
- storage cleanup
- arbitrary S3 object listing
- privileged object repair

Do NOT authorize based only on “logged in”.

Correct:

```text
Guest  -> deny
Member -> deny
Owner  -> allow
```

---

# 3.4 Playback read URLs

A playback URL is not the same thing as authorization.

Rules:

- storage bucket remains private
- public playback is allowed only for objects marked public
- server must resolve resource identity/visibility before signing
- never let user submit arbitrary storage key and receive a signed URL blindly
- never return raw fallback public S3 URL
- use short-lived URLs
- target expiry: ~15 minutes unless a documented reason exists

A generic endpoint like:

```text
getSignedUrl(key)
```

is NOT acceptable as the final architecture.

Prefer:

```text
getTrackPlaybackUrl(trackId)
getVideoPlaybackUrl(videoId)
```

Server resolves:

```text
trackId
→ DB row
→ file ownership
→ visibility
→ storage key
→ sign
```

---

# 3.5 S3 object keys

Canonical V2 format:

```text
audio/{trackId}/master.{ext}
video/{videoId}/master.{ext}
artwork/{assetId}/master.{ext}
artwork/{assetId}/{size}.{format}
lyrics/{trackId}/...
subtitles/{videoId}/...
backups/{snapshotId}/...
```

Do NOT use filename parsing as database truth.

Do NOT infer ownership from filename.

Do NOT keep the legacy:

```text
singles/
albums/
```

layout as the canonical V2 design.

A migration adapter may exist temporarily.

---

# 3.6 S3 listing

Guest must NOT be able to enumerate the bucket.

Member must NOT be able to enumerate the bucket.

Only privileged Owner/admin operations may list storage objects.

---

# 3.7 S3 delete

Before delete:

- verify Owner
- verify target object belongs to a known resource or explicit cleanup job
- never accept arbitrary user-controlled destructive keys without server-side resolution
- return true success only after actual deletion succeeds

Never report:

```text
deleted: true
```

if deletion merely returned a promise or was fire-and-forget.

---

# 3.8 RLS

RLS must match actual product policy.

If `tracks`, `albums`, `videos` have visibility semantics:

```text
public
members
owner
```

then public RLS must NOT be:

```sql
USING (true)
```

for all rows.

Anonymous and member reads must respect visibility.

Personal tables must use:

```sql
auth.uid() = user_id
```

or the appropriate equivalent.

Owner-only mutations must be enforced in DB/server where possible.

---

# 4. CANONICAL DATA RULE

## 4.1 One source of truth

The final architecture must be:

```text
Supabase PostgreSQL
    ↓
canonical metadata / relationships / user data

Pikamc S3
    ↓
canonical binary objects

TanStack Query / client stores
    ↓
cache / UI state

localStorage
    ↓
preferences only
```

Do NOT use:

- `localStorage` as master library database
- module-level mutable arrays as canonical database
- runtime S3 manifest as primary database

---

# 4.2 Remove runtime master-library fallback

Boot must NOT do:

```text
localStorage
→ global arrays
→ S3 manifest
```

as the primary flow.

Desired:

```text
DB query
→ normalized domain data
→ query cache
→ UI
```

Manifest should be:

- recovery
- snapshot
- migration bridge
- emergency repair input

not normal runtime master state.

---

# 4.3 Empty DB must be a valid state

If DB returns:

```text
0 tracks
0 albums
0 videos
```

that is a valid empty library.

Do NOT interpret empty arrays as:

```text “DB failed”
```

and silently restore an old manifest.

---

# 4.4 True replace semantics

If a “replace master library” operation exists:

```text incoming A/B
current A/B/C
```

the final DB must be:

```text A/B
```

not:

```text A/B/C
```

You must reconcile deletions, not only UPSERT rows.

Use a safe transactional strategy.

---

# 5. DATA MODEL V2

The target model must include, at minimum:

## Master data

```text
artists
albums
tracks
videos

track_files
video_files

media_analysis
artwork_assets
lyrics_documents
subtitle_assets
```

## Identity

```text
profiles
external_identities
```

## Member data

```text
user_favorites
playlists
playlist_tracks
playback_history
playback_state
user_preferences
```

## Operations

```text
upload_jobs
share_links
audit_logs
backup_snapshots
```

---

# 5.1 Track / TrackFile separation

A `Track` is identity/metadata.

A `TrackFile` is physical media.

Example:

```text
Track
  id
  title
  artist_id
  album_id
  year
  ...

TrackFile
  id
  track_id
  storage_key
  container
  codec
  sample_rate
  bit_depth
  channels
  bitrate
  duration
  file_size
  sha256
  verified_at
```

Do NOT cram physical file facts into loosely-defined UI metadata fields.

---

# 5.2 Artwork model

Master artwork must not be conflated with generated derivatives.

Store:

```text
master
256
512
1024
2048
```

Derivatives are cache/display assets.

Master remains untouched.

---

# 5.3 Lyrics model

Lyrics must support:

- plain lyrics
- synced lyrics
- source/provider
- confidence
- verification
- offset
- versioning
- timestamps
- language
- created_at
- updated_at

Do not rely solely on one JSON blob in `tracks.lyrics` if the Master Plan requires history and provenance.

---

# 6. MEDIA INGESTION V2

## 6.1 This is a critical phase.

Desired flow:

```text
Select file(s)
    ↓
Analyze
    ↓
Extract metadata
    ↓
Extract artwork
    ↓
Extract lyrics candidates
    ↓
Compute checksum
    ↓
Duplicate check
    ↓
Spotify/identity match (future)
    ↓
Review Center
    ↓
User confirms
    ↓
Upload session
    ↓
Upload
    ↓
Verify
    ↓
Commit DB
```

---

# 6.2 Unknown is better than fake

NEVER hardcode:

```text
24-bit
96kHz
4K
H.264
12.5 Mbps
180 seconds
```

when the actual media does not prove it.

Correct:

```text
unknown
pending analysis
unverified
```

A Hi-Res badge must only appear from verified media analysis.

---

# 6.3 Audio analysis

Must be able to report actual:

- codec
- container
- sample rate
- bit depth
- channels
- bitrate
- duration
- file size
- lossless/lossy classification
- checksum

If browser analysis is incomplete:

- server-side authoritative analysis is required
- or field remains unknown
- never invent

---

# 6.4 Video analysis

Actual:

- container
- codec
- resolution
- FPS
- bitrate
- HDR if available
- audio codec
- audio channels
- duration
- subtitle tracks if detectable

---

# 6.5 SHA-256

Computing SHA-256 is not enough.

The hash must be:

- persisted
- queryable
- used for integrity
- used for duplicate detection where appropriate
- shown in Owner diagnostics where useful

Do not call SHA-256 “implemented” if it only lives in React state.

---

# 6.6 Duplicate detection

Primary duplicate identity should use:

```text
sha256
```

Metadata similarity can be a secondary warning.

Correct examples:

```text
same SHA → exact duplicate
same title+artist → possible duplicate
same title+artist but different SHA → NOT automatically same file
```

---

# 6.7 Batch upload

Support multiple files.

At minimum:

- queue
- bounded concurrency
- per-file status
- per-file progress
- overall progress
- retry
- cancel
- failure recovery

Do NOT launch unlimited concurrent uploads.

---

# 6.8 Upload session model

Create:

```text
upload_jobs
```

with explicit state:

```text
queued
analyzing
ready
uploading
verifying
committing
completed
failed
cancelled
```

---

# 6.9 Upload failure semantics

Do not partially commit DB rows.

Example:

```text audio upload success
artwork upload failure
```

must not silently create a “complete” track record.

Use:

- staging
- verification
- commit

or an equivalent transaction-like workflow.

---

# 7. PLAYER V2

## 7.1 Required invariants

- audio engine independent from heavy UI rendering
- queue state independent
- lyrics clock independent
- playback analytics independent
- UI re-render must not cause playback dropouts

---

# 7.2 Previous

Exact required behavior:

```text
current position > 3 sec
→ restart current

current position <= 3 sec
→ previous track
```

This behavior must have automated tests.

---

# 7.3 Crossfade

Product requirement is:

```text
0–10 seconds
```

NOT 12 seconds.

Use dual audio channels or a robust equivalent.

Do not claim:

- guaranteed 0ms latency
- guaranteed sample-accurate gapless in every browser
- guaranteed zero dropout on every device

Use honest wording:

> best-effort smooth gapless / crossfade in supported browser environments

---

# 7.4 ReplayGain

Implement:

```text
Off
Track Gain
Album Gain
```

Playback-only.

Never modify master audio.

---

# 7.5 Player storage

Persist:

- current track
- position
- volume
- queue if configured
- repeat mode
- shuffle preference if desired

Playback history must capture real timestamps rather than reconstructing them from duration where possible.

---

# 8. LYRICS V2

## 8.1 Keep

- waveform timeline
- playhead
- scrub
- nudge
- global offset
- live preview
- auto-scroll

These are important Duckroom features.

---

# 8.2 REMOVE

The Vietnamese lyric content auto-correction system.

Delete/disable:

- `SPELLING_CORRECTIONS`
- automatic content mutation
- “Sửa chính tả” button
- `correctVietnameseLyrics`
- any automatic wording correction

Allowed:

- trim whitespace
- normalize line breaks
- sort timestamps
- detect malformed timestamps
- warn about duplicates
- structural cleanup

DO NOT rewrite lyric wording automatically.

---

# 8.3 “Canh nhịp”

If the product decision remains “remove this feature”, remove it from UI and implementation.

Do not leave dead or misleading controls.

---

# 8.4 Lyrics versioning

User/Owner should be able to:

- edit
- preview
- save
- compare/revert

At minimum, preserve previous lyric versions.

---

# 8.5 Provider provenance

Track source:

```text
embedded
LRCLIB
Lyrics.ovh
community
manual
imported
```

and confidence/verification state.

---

# 9. MEMBER EXPERIENCE

Required:

- Favorites
- Playlists
- Recently Played
- Continue Listening
- Playback position
- personal library settings

Playlist must support:

- create
- rename
- delete
- add
- remove
- reorder
- cover/description if specified
- persistence

---

# 9.1 Custom library

“Favorites page” alone is insufficient.

Target:

```text
Your Library
  Pinned
  Favorites
  Albums
  Playlists
  Recently Played
  custom ordering / view preferences
```

Keep this personalized without copying Spotify visually.

---

# 10. SHARING

Required:

```text
/s/:token
```

Must support:

- short professional link
- SSR metadata
- artwork
- title
- artist
- description
- social cards
- short-lived playback authorization

---

# 10.1 Revocation

Share links need:

- revoke
- optional expiry
- resource scope
- audit metadata

Do not create a `revoked_at` column and then leave the feature unusable.

---

# 10.2 Guest share

Public Guest should be able to share public content where allowed.

Do not force Guest to become Member just to generate a share link if product policy says sharing is public.

---

# 11. OWNER CONTROL ROOM

Required:

- overview
- user counts
- track/albums/videos
- storage health
- orphan assets
- failed uploads
- audit logs
- backups
- restore
- integrity checks

---

# 11.1 Orphan scanner

Must understand ALL current object categories:

- audio master
- video master
- artwork master
- artwork derivatives
- subtitle assets
- backup snapshots
- future media assets

Do not scan only legacy `tracks.storage_key`.

---

# 11.2 Orphan cleaner

Deletion must be:

- explicit
- Owner-only
- server-authorized
- verified
- accurately reported

Do not append an object to `deleted[]` unless actual deletion succeeded.

---

# 11.3 Backup

Snapshot must have:

```text
backup_snapshots
id
created_by
storage_key
checksum
created_at
size
status
```

Need:

- create
- inspect
- restore
- verify

Do not call backup complete without restore.

---

# 12. SECURITY TEST MATRIX

Create automated tests or scripted verification for:

## Guest

```text
GET public track        → allowed
play public track       → allowed

favorite mutation       → deny
playlist mutation       → deny
master upload           → deny
master delete           → deny
S3 list                 → deny
S3 arbitrary sign       → deny
```

## Member

```text
favorite own            → allow
playlist own            → allow
history own             → allow

master upload           → deny
master metadata edit    → deny
master delete           → deny
S3 arbitrary put        → deny
S3 arbitrary delete     → deny
S3 list                 → deny
manifest overwrite      → deny
```

## Owner

```text
master upload           → allow
master edit             → allow
master delete           → allow
storage scan            → allow
cleanup                 → allow
backup                  → allow
restore                 → allow
user management         → allow
```

These must be verified at the server boundary, not only in UI.

---

# 13. FAILURE-INJECTION TESTS

You MUST test:

- missing env
- expired auth
- invalid auth
- S3 403
- S3 404
- S3 500
- upload interrupted
- artwork upload failure
- DB failure
- malformed manifest
- malformed lyrics
- duplicate upload
- missing media object
- deleted DB row
- orphan S3 object
- revoked share
- expired share

Each failure must produce:

- correct HTTP/result code
- correct user-facing state
- no false success
- no silent data corruption

---

# 14. PERFORMANCE / MOTION

Do not claim:

> 60 FPS
> zero-jank

from source inspection alone.

Require actual profiling evidence.

Test at minimum:

### Desktop
- normal hardware
- CPU throttled
- slow network

### Mobile
- mid-range device
- CPU throttled
- slow network

Measure:

- long tasks
- React commits
- layout/reflow
- paint/composite
- animation frame drops
- visualizer CPU
- artwork decode
- player stability

---

# 14.1 Motion rules

Keep:

- motion tokens
- reduced motion
- purposeful transitions
- restrained spring

Avoid:

- arbitrary per-component durations
- animation stacking
- unnecessary blur/filter animation
- expensive box-shadow animation
- large backdrop-filter surfaces during continuous playback

A transition is complete only if it improves perceived continuity without harming frame rate.

---

# 15. TEST INFRASTRUCTURE

Create real test infrastructure.

At minimum:

## Unit tests

- storage key validation
- auth policy
- role policy
- player transitions
- queue
- shuffle
- repeat
- LRC parse/offset
- metadata analysis mapping
- duplicate rules

## Integration tests

- favorites
- playlists
- history
- share links
- S3 authorization
- DB mutations

## E2E

- Guest
- Member
- Owner
- upload
- play
- lyrics
- share
- admin

CI must fail on:

- type errors
- lint errors
- test failures
- build failures

---

# 16. ENV / SECRET HYGIENE

Search repository for:

```text
VITE_S3_SECRET
VITE_*SECRET*
VITE_*SERVICE_ROLE*
hardcoded S3 secret
hardcoded Supabase service role
```

Remove all.

`.env` must never be committed.

`.env.example` must NEVER contain a `VITE_*` server secret.

Do not hardcode:

- S3 bucket
- S3 endpoint
- secret credentials

Prefer environment config.

---

# 17. DOCUMENTATION TRUTHFULNESS

Update:

- `DUCKROOM_MASTER_PLAN.md`
- `AGENTS.md`
- `docs/DUCKROOM_AGENT_CONTEXT.md`
- README
- implementation report

Do NOT leave contradictory documents where:

```text one file says complete
another says not implemented
```

Every phase must use one of:

```text COMPLETE
PARTIAL
BLOCKED
UNVERIFIED
```

Never use “100%” without evidence.

---

# 18. REQUIRED VERIFICATION COMMANDS

You MUST run and show output for:

```bash
npm ci
npx tsc --noEmit
npm run lint
npm run build
npm test
```

If a test command does not exist yet:

- add the test framework
- add at least critical-path tests
- then run it

Also run repository searches for known forbidden patterns.

Examples:

```bash
rg "VITE_S3_SECRET|VITE_.*SERVICE_ROLE|service_role" .
rg "expiresIn: 604800|604800" .
rg "24.*96|4K Hi-Res|12\.5 Mbps|resolve\(180\)" src
rg "SPELLING_CORRECTIONS|correctVietnameseLyrics|Sửa chính tả|Canh nhịp" src
rg "library_manifest|localStorage|tracks: Track\[\]|albums: Album\[\]" src
```

Adapt commands to OS.

---

# 19. DO NOT CHEAT

The following are forbidden:

- hardcoded fake metadata
- fake progress
- fake duplicate detection
- UI-only authorization
- optimistic success without server confirmation
- swallowing errors as empty arrays
- returning raw S3 URLs as fallback
- “best effort” security
- marking an item complete because a button exists
- replacing a real implementation with a stub
- reducing type coverage just to make `tsc` pass
- disabling tests
- suppressing lint errors without justification
- removing security checks to unblock builds

---

# 20. CHANGE STRATEGY

Do NOT rewrite the whole application at once.

Preferred order:

## Phase A — P0 Security

Fix all security blockers first.

## Phase B — Canonical data

Move runtime to DB truth.

## Phase C — Media model

Create track_files/media_analysis/artwork_assets/etc.

## Phase D — Upload V2

Build proper ingestion and verification.

## Phase E — Player hardening

Split engine/state.

## Phase F — Lyrics

Remove unwanted auto-correction; add version/provenance.

## Phase G — Member completeness

Finish personal-library behaviors.

## Phase H — Sharing

Finish revoke/expiry/guest behavior.

## Phase I — Owner operations

Finish restore and safe cleanup.

## Phase J — Performance

Profile and prove motion smoothness.

## Phase K — Tests/CI

Complete verification gates.

## Phase L — Spotify

ONLY after all above are stable.

---

# 21. ACCEPTANCE CRITERIA

A phase may be marked `COMPLETE` only if ALL are true:

1. Requirement implemented.
2. Happy path works.
3. Failure path handled.
4. Authorization boundary tested.
5. Persistence semantics verified.
6. No fake values.
7. No known architecture contradiction.
8. Relevant tests exist.
9. Build/lint/typecheck pass where applicable.
10. Documentation updated.
11. No critical or high severity known issue remains in that phase.

---

# 22. REQUIRED REPORT FORMAT AFTER WORK

At the end of the implementation, DO NOT write marketing prose.

Return this exact structure:

```md
# Duckroom V2 Remediation Report

## 1. EXECUTIVE STATUS
Overall:
Security:
Data:
Upload:
Player:
Lyrics:
Member:
Sharing:
Owner:
Motion:
Tests:

## 2. COMPLETED
- exact item
- exact file(s)
- exact behavior
- verification evidence

## 3. PARTIAL
- exact gap
- why
- next step

## 4. BLOCKED
- blocker
- required external input

## 5. UNVERIFIED
- item
- why it cannot be proven yet

## 6. SECURITY FINDINGS
Critical:
High:
Medium:
Low:

## 7. TEST RESULTS
npm ci:
tsc:
lint:
build:
unit:
integration:
e2e:

## 8. MANUAL VERIFICATION
Guest:
Member:
Owner:
Upload:
Player:
Lyrics:
Share:
Admin:

## 9. KNOWN LIMITATIONS
...

## 10. FINAL VERDICT
One of:
NOT READY
PRE-PRODUCTION
PRODUCTION CANDIDATE
PRODUCTION READY
```

---

# 23. STOP CONDITIONS

You MUST stop and ask for human input if:

- migration could destroy production data
- credentials are invalid/unknown
- changing storage layout risks breaking existing media
- an irreversible deletion is required
- Spotify/API credentials are required
- a product decision is ambiguous
- a security policy conflicts with the current product requirements

Do NOT silently choose a destructive interpretation.

---

# 24. FINAL MANDATE

Your job is NOT:

> “Make the repo look finished.”

Your job is:

> **Make Duckroom actually correct.**

Use this rule throughout the project:

### “Implementation is not completion.”
### “A green build is not production readiness.”
### “A UI control is not a feature until the server, database, storage, failure path, and verification all agree.”
### “Unknown is better than fake.”
### “Security is enforced at the server boundary.”
### “Database truth must be singular.”
### “Do not claim what you cannot prove.”

---

# 25. FINAL PRIORITY ORDER

## P0 — BLOCKING

- S3 authorization
- Member/Owner boundaries
- public S3 listing
- raw URL fallback
- signed URL lifetime inconsistency
- RLS visibility
- server-only secrets
- actual credential hygiene

## P1 — CORE

- canonical DB runtime
- real media model
- real media analysis
- real SHA persistence
- duplicate integrity
- upload sessions
- safe upload commit
- retry
- player hardening
- lyric content mutation removal

## P2 — PRODUCT COMPLETION

- Member library completeness
- sharing completeness
- Owner restore
- audit/integrity tools
- performance proof

## P3 — OPTIONAL/EXPANSION

- Spotify bridge
- desktop app
- deeper audiophile integrations
- advanced recommendation-like convenience features

---

# 26. GOLDEN RULE

Before marking anything done, ask:

> **“Can I prove this with code, database state, a test, and a real runtime observation?”**

If the answer is no:

```text
DO NOT SAY DONE.
```

Use:

```text
UNVERIFIED
```

or:

```text
PARTIAL
```

instead.

---

# 27. CURRENT KNOWN FINDINGS THAT MUST NOT BE LOST

The current audit has already identified, at minimum:

- generic S3 read signing can be requested too broadly
- upload/delete/manifest S3 endpoints are not Owner-only
- S3 list is insufficiently protected
- server security middleware is effectively no-op
- generic S3 read endpoint still has 7-day expiry in some paths
- raw S3 URL fallback exists
- RLS visibility does not fully match product visibility
- localStorage/module arrays still behave as master state in places
- empty DB can still fall back to stale manifest behavior
- DB “replace” logic is not true replace
- target V2 media tables are incomplete
- canonical V2 storage layout is not fully migrated
- upload is not a true batch upload session architecture
- SHA is not fully persisted as media identity
- duplicate detection is metadata-based, not checksum-first
- audio metadata can still be synthetic
- video metadata can still be synthetic
- duration can still be synthetic
- artwork upload success semantics need hardening
- upload size/content validation is incomplete
- retry/resumable upload is incomplete
- player still needs deeper engine separation
- crossfade is 12s in places while product requirement is 10s
- ReplayGain is missing
- Vietnamese lyric auto-correction still exists
- “Sửa chính tả”/“Canh nhịp” must be removed if product decision remains so
- lyric versioning/provenance is incomplete
- custom Member library is incomplete
- share revoke/expiry workflow is incomplete
- Owner restore is incomplete
- orphan cleanup success reporting needs correction
- motion “60 FPS” is not proven by runtime profiling
- no real test suite/CI proof yet
- repository documentation is internally contradictory
- `.env` and legacy secret patterns must be removed from repository hygiene

---

# 28. DO THIS FIRST

Do NOT start Spotify.

Do NOT add new cosmetic features.

Do NOT add random abstractions.

Start with:

```text
P0 SECURITY REMEDIATION
→
VERIFY
→
P1 CANONICAL DATA
→
VERIFY
→
P1 MEDIA / UPLOAD
→
VERIFY
→
PLAYER / LYRICS
→
VERIFY
→
MEMBER / SHARE / OWNER
→
VERIFY
→
PERFORMANCE
→
VERIFY
→
CI / RELEASE GATE
→
ONLY THEN SPOTIFY
```

**You are authorized to refactor aggressively where necessary, but preserve Duckroom’s visual identity, player concept, waveform identity, lyrics-first philosophy, and overall user experience direction.**
