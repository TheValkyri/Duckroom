# DUCKROOM MEDIA METADATA AUTHORITY ARCHITECTURE
## Single Source of Physical Truth & Non-Fabrication Protocol

---

## 1. Architectural Authority Hierarchy

The Duckroom audio/video domain maintains a strict, non-negotiable separation between **Master Domain Display/Catalog Metadata** and **Physical File Technical Metadata**:

```
+-------------------------------------------------------------------------------+
|                       MASTER DOMAIN (Logical Catalog)                        |
|                                                                               |
|  public.albums          public.tracks                 public.videos           |
|  - id                   - id                          - id                    |
|  - title                - title                       - title                 |
|  - artist               - artist                      - artist                |
|  - year                 - track_no                    - year                  |
|  - cover_storage_key    - lyrics (jsonb array)        - thumb_storage_key     |
|  - accent               - year                        - duration_seconds      |
|  - note                 - size_mb (DISPLAY ONLY)      - size_mb (DISPLAY ONLY)|
|                         - sample_rate (LEGACY/FALLBACK)                       |
|                         - bit_depth (LEGACY/FALLBACK)                         |
|                         - format (LEGACY/FALLBACK)                            |
+---------------------------------------+---------------------------------------+
                                        | 1:N Master Files
                                        v
+-------------------------------------------------------------------------------+
|                   CANONICAL PHYSICAL MEDIA LAYER (Authoritative)              |
|                                                                               |
|  public.track_files                           public.video_files              |
|  - id (UUID)                                  - id (UUID)                     |
|  - track_id -> tracks(id)                     - video_id -> videos(id)        |
|  - storage_key (UNIQUE)                       - storage_key (UNIQUE)          |
|  - extension                                  - container                     |
|  - container (e.g. FLAC, MP3, WAV)            - codec (e.g. H.264, H.265)     |
|  - sample_rate (INTEGER Hz, e.g. 96000)       - resolution (e.g. 3840x2160)   |
|  - bit_depth (INTEGER bits, e.g. 24)          - duration_seconds              |
|  - duration_seconds (DOUBLE PRECISION)        - file_size_bytes (INTEGER/BIGINT)
|  - file_size_bytes (Exact measured bytes)     - sha256 (Measured hex string)  |
|  - sha256 (64-char hex string)                - verified_at (TIMESTAMPTZ)     |
|  - verified_at (TIMESTAMPTZ)                                                  |
+---------------------------------------+---------------------------------------+
                                        | Linked via Ingestion Pipeline
                                        v
+-------------------------------------------------------------------------------+
|                     SERVER MEDIA ANALYSIS RECORDS                             |
|                                                                               |
|  public.media_analysis_records                                                |
|  - id (UUID)                                                                  |
|  - resource_kind ('track' | 'video' | 'artwork')                              |
|  - storage_key                                                                |
|  - track_file_id -> track_files(id)                                           |
|  - video_file_id -> video_files(id)                                           |
|  - sha256 (Calculated from full binary buffer/stream)                         |
|  - analysis_status ('verified' | 'failed' | 'quarantined')                    |
|  - verified_at (TIMESTAMPTZ)                                                  |
+-------------------------------------------------------------------------------+
```

---

## 2. Invariants and Rules

### Rule 1: Non-Fabrication of Physical Metadata
- **Manifest / Cold Reconciliation:** When tracks/videos are imported from cold manifests or replaced via atomic RPC without full binary analysis, `file_size_bytes`, `sha256`, and `verified_at` are **strictly set to NULL**.
- **No Float Multiplication:** The server never multiplies `size_mb * 1024 * 1024` to synthesize `file_size_bytes`.
- **Caller Claim != Verified Fact:** A caller-supplied SHA-256 or byte count in an HTTP payload or RPC parameter is treated as an unverified suggestion, NEVER as server-verified truth. It **never triggers `verified_at = NOW()`**.

### Rule 2: Single Channel for `verified_at` Establishment
- `verified_at` can ONLY be set by the server media analysis pipeline (`verifyAndAnalyzeServerUploadInternal` / `finalizeIngestionCommitInternal`).
- The server directly hashes the binary stream, measures exact bytes, extracts container headers, and sets `verified_at = NOW()`.

### Rule 3: Conflict Resolution & Precedence
- When reading media properties in runtime queries (`getPublicMasterLibraryInternal`, `sharing.ts`, playback streaming), verified `track_files` / `video_files` records **strictly override** any legacy columns (`tracks.size_mb`, `tracks.sample_rate`, `tracks.bit_depth`, `videos.size_mb`, etc.).
- Legacy columns are strictly retained for backward compatibility and display fallbacks when unverified.
- Updates via `updateTrackInDatabaseInternal` / `updateVideoInDatabaseInternal` alter display attributes only and cannot overwrite verified physical metadata in `track_files` / `video_files`.

---

## 3. Verification Coverage

The invariants are verified in the automated Vitest test suite (`src/test/authoritative-media-metadata.test.ts`):
- Cold migration non-fabrication (NULL bytes, NULL SHA, NULL `verified_at`).
- Server ingestion commit of exact measured bytes and SHA-256.
- Physical metadata precedence over legacy `size_mb` / `sample_rate`.
- Error handling on SHA-256 or size mismatch between client claim and server measurement.
