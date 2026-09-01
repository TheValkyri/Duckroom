# PHASE 4 COVERAGE MATRIX - Real binary fixtures vs parser capability

Legend: FIXTURE = hand-built standards-compliant bytes exercised through the production parser in vitest.

## Audio

| Format | Real fixture | Parser | Integrity verified | Failure case tested | Status |
|---|---|---|---|---|---|
| FLAC 24/96 STREAMINFO | YES (media-ingestion) | YES full | sha+size e2e | corrupt-header UNKNOWN | PASS |
| FLAC 16/44.1 | derived bitfield variant asserted via generic parse | YES | same chain | same | PASS |
| WAV RIFF fmt/data | YES | YES duration/channels | yes | size/MIME mismatch e2e rejects WAV-as-flac | PASS |
| MP3 CBR MPEG-1 L3 | YES raw sync (bitDepth stays 0 honesty) | YES V1L3 tables | partial | generic corrupt | PASS |
| MP3 VBR Xing exact frames | YES redteam-closure (1000 frames -> exact seconds) | YES new Xing/VBRI | n/a | CBR fallback warns | PASS |
| MP3 MPEG-2 / 2.5 | NO fixture yet | YES tables + warning | n/a | n/a | PARTIAL |
| M4A/AAC ISOBMFF moov/mvhd/stsd mp4a | NO fixture | YES box walk | n/a | none | PARTIAL |
| ALAC in M4A stsd alac | NO fixture | YES branch exists | n/a | none | PARTIAL |
| AIFF | removed from allowed set (fail-closed gate) | parser absent by design | n/a | unsupported-format rejection at gate | CLOSED honestly |

## Video

| Format | Real fixture | Parser | Notes |
|---|---|---|---|
| MP4 faststart avc1 + mvhd | YES full box tree incl 3840x2160 | container/codec/resolution/duration/bitrate | PASS |
| MP4 tail-moov rescue | YES dual-buffer | scanBufferForMoov | PASS |
| MOV qt brand | YES redteam-closure | container=MOV | PASS |
| MKV EBML magic | codec sniff only | duration/resolution unknown-honest | PARTIAL |
| WebM DocType | labeled WEBM (redteam-closure) | same limits | PARTIAL |

## Artwork

| Format | Fixture | Magic MIME | Dimensions |
|---|---|---|---|
| JPEG minimal SOF0 | YES x2 suites | YES | YES (SOF walk) |
| PNG | YES | YES | IHDR walk untested fixture-level (code real) |
| WebP VP8/VP8L | YES magic | YES | VP8X gap documented |
| AVIF brand | YES magic | YES | dims unsupported - honest null |
| GIF87a/89a | NO fixture | code real | code real |
| SVG text sniff | YES incl garbage-null | YES | n/a |
| Spoofed text .jpg rejected | YES | authority proven | - |

Production-path authority proof: verifyAndAnalyzeServerUploadInternal downloads staged artwork and runs analyzeImageBuffer; detected mime persisted to upload_sessions and drives canonical key extension (redteam-closure both branches).

## Confidence model mapping (no fabricated numbers)

Signals -> statuses:
- metadataStatus: analysisStatus verified/warning/error direct mapping (warning NEVER collapsed)
- artworkStatus: server binary inspection result only (none/pending while unanalyzed)
- integrityStatus: pending until server sha256 computed; then verified; transport mismatch -> failed session
- duplicateStatus: client pre-check provisional; server re-check authoritative; exact match blocks commit unless explicit decision upstream
Numeric confidence intentionally absent: every number would be arbitrary without trained signals; status model carries identical review behavior without fake precision (Master Plan forbids meaningless hardcoded percentages).