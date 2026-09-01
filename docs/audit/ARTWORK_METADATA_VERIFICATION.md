# DUCKROOM ARTWORK METADATA & MIME NON-FABRICATION VERIFICATION
## Blocker D Resolution: Dynamic MIME Detection, Magic Bytes Verification, Spoofing Rejection

---

## 1. Problem Description & Root Cause Resolution

In earlier RPC drafts, artwork insertion used hardcoded `'image/jpeg'` for all cover keys. This resulted in false MIME claims for `.png`, `.webp`, `.avif`, `.gif`, `.svg`, or custom asset storage keys.

**Invariant Established:**
> "Do NOT blindly assume JPEG. The source of MIME must be explicit."
> "Server/binary truth must win."

---

## 2. Technical Implementation

### A. Authoritative Server Binary Image Analyzer
In `src/services/media-analysis/image-analyzer.ts`:
- Inspects magic bytes directly from the binary buffer:
  - **JPEG:** `FF D8 FF` -> `image/jpeg`
  - **PNG:** `89 50 4E 47 0D 0A 1A 0A` -> `image/png`
  - **WebP:** `RIFF .... WEBP` -> `image/webp`
  - **AVIF:** `.... ftyp (avif | avis | mif1)` -> `image/avif`
  - **GIF:** `GIF87a` / `GIF89a` -> `image/gif`
  - **SVG:** `<?xml` / `<svg` -> `image/svg+xml`
- Extracts dimensions (width/height) from binary headers.
- Rejects spoofed extensions where binary magic bytes do not match declared extension.

### B. Dynamic Fallback in RPC & Manifest Reconciliation
In `replace_master_library_atomic` and `src/lib/manifest-migration.ts`:
```sql
CASE
  WHEN lower(cover_key) ~ '\.(jpg|jpeg)$' THEN 'image/jpeg'
  WHEN lower(cover_key) ~ '\.png$' THEN 'image/png'
  WHEN lower(cover_key) ~ '\.webp$' THEN 'image/webp'
  WHEN lower(cover_key) ~ '\.avif$' THEN 'image/avif'
  WHEN lower(cover_key) ~ '\.gif$' THEN 'image/gif'
  WHEN lower(cover_key) ~ '\.svg$' THEN 'image/svg+xml'
  ELSE NULL -- Explicit NULL for unverified/unknown format
END
```
On conflict, preserves already verified MIME types:
```sql
ON CONFLICT (master_storage_key) DO UPDATE SET
  mime_type = COALESCE(public.artwork_assets.mime_type, EXCLUDED.mime_type);
```

---

## 3. Automated Test Suite

Implemented in `src/test/artwork-metadata.test.ts` (9 tests):
1. Genuine JPEG binary detection (`FF D8 FF`).
2. Genuine PNG binary detection (`89 50 4E 47 ...`).
3. Genuine WebP binary detection (`RIFF....WEBP`).
4. Genuine AVIF binary detection (`....ftypavif`).
5. Genuine SVG header detection (`<svg ...`).
6. Rejection of spoofed extensions (plain text named `.jpg` throws).
7. Non-image or corrupt binary returns `null` or throws structured error.
8. Extension mapping supports PNG, WebP, AVIF, GIF, SVG, JPEG, with `null` for unknown formats.
9. Manifest migration sets proper MIME types without default JPEG assumption.
