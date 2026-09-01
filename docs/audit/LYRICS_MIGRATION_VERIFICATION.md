# DUCKROOM LYRICS MIGRATION & DATA INTEGRITY VERIFICATION
## Blocker A Resolution: Zero Data Loss, Multi-Line Preservation, Unique Canonical Identity

---

## 1. Problem Description & Root Cause Resolution

In previous revisions, lyrics migration risks existed where single-element JSON extraction (`->>0` or text casting) could truncate multi-line synchronized lyrics arrays to a single line or drop lines. 

**Invariant Established:**
> "A successful migration with only the first lyric line is a DATA LOSS BUG."
> Complete synchronized lyrics arrays (`[{ time: number, text: string }]`) must be preserved in full fidelity without line truncation or loss of precision.

---

## 2. Technical Implementation

### A. Database Unique Canonical Identity
In migration `20260826_duckroom_v2_canonical_integrity_closure.sql` and `supabase/schema.sql`:
```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_lyrics_documents_canonical_identity
  ON public.lyrics_documents(track_id, source, kind, version);
```

### B. Full Array JSON Serialization
In `replace_master_library_atomic` and `src/lib/manifest-migration.ts`:
- Entire `lyrics` JSONB array is preserved as text: `COALESCE(x->'lyrics', '[]'::jsonb)::text`.
- Empty arrays do not produce orphaned lyric documents.
- Upsert logic is strictly idempotent on `(track_id, source, kind, version)`:
```sql
INSERT INTO public.lyrics_documents (track_id, source, kind, content, version)
SELECT
  x->>'id',
  'legacy-json',
  CASE WHEN jsonb_typeof(COALESCE(x->'lyrics', '[]'::jsonb)) = 'array'
            AND jsonb_array_length(COALESCE(x->'lyrics', '[]'::jsonb)) > 0
       THEN 'synced' ELSE 'plain' END,
  COALESCE(x->'lyrics', '[]'::jsonb)::text,
  1
FROM jsonb_array_elements(COALESCE(p_tracks, '[]'::jsonb)) x
WHERE jsonb_typeof(COALESCE(x->'lyrics', '[]'::jsonb)) = 'array'
  AND jsonb_array_length(COALESCE(x->'lyrics', '[]'::jsonb)) > 0
ON CONFLICT (track_id, source, kind, version) DO UPDATE SET
  content = EXCLUDED.content,
  kind = EXCLUDED.kind,
  updated_at = NOW();
```

### C. Integer-Hundredths LRC Time Formatting
In `src/lib/lyrics-formatter.ts`:
- Converted timestamp formatting from floating-point modulo to integer arithmetic (`Math.round(line.time * 100)`).
- Eliminates IEEE 754 precision loss bugs (e.g. `5.8` converting to `5.79`).

---

## 3. Automated Test Suite

Implemented in `src/test/lyrics-migration-integrity.test.ts` (5 tests) and `src/test/lyrics-formatter.test.ts` (5 tests):
1. **Multi-line Synced Lyrics Preservation:** Tests 5-line synced song structure; verifies 5 lines in exact order and timing.
2. **Single-Line and Empty Lyrics:** Verifies 1-line lyric correctly preserved; verifies empty array does not create empty documents.
3. **Repeated Migration Idempotency:** Verifies executing manifest migration repeatedly produces identical state without duplicate key collisions.
4. **Exact Round-Trip Precision:** Verifies LRC text -> LyricLine array -> LRC text preservation.
5. **Malformed LRC Graceful Degradation:** Verifies corrupted lines or missing milliseconds are parsed without crashing or discarding valid lines.
