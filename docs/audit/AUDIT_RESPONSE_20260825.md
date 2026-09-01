# AUDIT RESPONSE — P1/P2 Fixes (2026-08-25)

> Phản hồi cho independent review của artifact `duckroom-source-clean.zip`
> (phiên bản trước). Mỗi finding được đối chiếu, xử lý hoặc ghi nhận rõ trạng
> thái. Evidence = file/function/test case cụ thể.


> ℹ️ **POINT-IN-TIME EVIDENCE**: test counts trong tài liệu này là snapshot lịch sử. Current truth duy nhất: docs/audit/CURRENT_VERIFICATION.md.

## Tóm tắt xử lý

| # | Finding | Mức | Xử lý |
|---|---|---|---|
| 1 | `user_preferences` có DB nhưng Player vẫn dùng localStorage/session state | 🔴 P1 | ✅ **FIXED** — `player-preferences-sync.ts` + wiring trong `PlayerProvider` |
| 6 | Playlist reorder tuần tự → partial-write risk | 🔴 P1 | ✅ **FIXED** — atomic SQL RPC `reorder_playlist_tracks` (migration 20260903) |
| 7 | Playback history không idempotent | 🟠 P1 | ✅ **FIXED** — `client_event_id` unique + upsert-ignore (migration 20260904) |
| 8 | Leader election có dual-leader window | 🟠 P1 | ✅ **FIXED** — CLAIM phase + monotonic lowest-id acceptance |
| 9 | Guest position làm tròn số nguyên | 🟡 P2 | ✅ FIXED — giữ 3 chữ số thập phân |
| 5 | ZIP thiếu docs/ (Master Plan, audits…) | 🔴 P2 | ✅ FIXED — package mới chứa toàn bộ `docs/` |
| 3/2 | README overclaim + `plan.md` stale Phase 0–3 | 🟡 P2 | ✅ FIXED — README tách 4 mức verification; plan.md gắn banner HISTORICAL |
| 14 | Migration dates "tương lai" | 🟡 P2 | ✅ Documented — convention ngày giả lập thể hiện THỨ TỰ, không phải lịch (ghi trong README + plan.md + handoff) |
| 10 | Lyrics search gọi provider trực tiếp từ client | 🟡 P2 | ⏸ DEFERRED (lý do bên dưới) |
| 12 | `listUserLibraryInternal` scalability | 🟡 P2 | ⏸ DEFERRED (lý do bên dưới) |
| 15 | Chưa chạy độc lập 293 tests vì npm ci timeout | 🟡 P2 | Hướng dẫn chạy kèm bên dưới |

---

## Chi tiết fix

### Fix #1 — Preferences ↔ Player runtime (finding #4/#5)

**Vấn đề:** migration `20260902` tạo bảng `user_preferences`, server có
get/save, nhưng `player.tsx` không bao giờ gọi — volume/crossfade/RG-mode chỉ
sống trong useState + localStorage. Member đổi máy = mất setting. Đây là
split-state mà chính bảng này sinh ra để giải quyết.

**Thiết kế:** module mới `src/lib/player-preferences-sync.ts`:

```text
login ─→ hydrate(): GET user_preferences → applyServerPreferences()
                    → actions.setVolume / setCrossfade / setRgMode
change ─→ report(delta): debounce 2s, merge deltas → saveUserPreferencesServer
hide/unload ─→ flush() (dùng chung chu kỳ với playback persister)
logout ─→ cancel() + reset gate (login sau hydrate lại từ server)
```

An toàn:
- **Không echo-write**: trước khi hydrate thành công, mọi `report()` bị bỏ qua
  — tránh việc ghi đè defaults bịa lên row thật khi mạng lỗi.
- Guest hoàn toàn không đi vào đường này.
- Timer injectable → policy test được bằng fake timers
  (`player-preferences-sync.test.ts`: 6 cases gồm no-echo-before-hydrate,
  merge+debounce, flush/cancel, save-failure swallowed).

Wiring: `player.tsx` — effect `[isLoggedIn]` hydrate 1 lần/login;
effect `[volume, crossfade, replayGainMode]` report delta. localStorage RG key
vẫn ghi song song (guest + instant-restore), server là nguồn đồng bộ chéo
thiết bị cho Member.

### Fix #6 — Atomic playlist reorder

**Vấn đề:** vòng lặp UPDATE tuần tự có cửa sổ partial-write (row1 OK, row2
FAIL → vị trí lẫn lộn).

**Thiết kế:** migration `20260903_duckroom_v2_atomic_playlist_reorder.sql`
tạo function:

```sql
reorder_playlist_tracks(p_playlist_id uuid, p_ordered_track_ids text[],
                        p_actor uuid) RETURNS int
```

- Validate: tồn tại → owner khớp actor → cardinality + no-dup + no-unknown-id.
- Rewrite TẤT CẢ position trong **một statement duy nhất**
  (`UPDATE … FROM unnest(… WITH ORDINALITY)`) — all-or-nothing của Postgres.
- Row-count check sau ghi (`MEMBERSHIP_MISMATCH` nếu thiếu).
- Grants: REVOKE PUBLIC/anon, GRANT EXECUTE chỉ cho `service_role`.
- `member-data.reorderPlaylistInternal` giờ gọi `db.rpc(...)` và map error code
  sang thông báo tiếng Việt; guards client-side (empty/dupes) giữ lại để fail
  fast. UI optimistic rollback ở hook giữ nguyên.

Tests: `member-reorder-preferences.test.ts` viết lại 6 cases quanh rpc contract
(kể cả verbatim error passthrough).

### Fix #7 — Idempotent playback history

Migration `20260904`: cột `playback_history.client_event_id TEXT` + unique
index (NULL exempt nên legacy rows an toàn, không cần backfill).

`appendPlaybackHistoryInternal` chuyển sang upsert
`{ onConflict: "client_event_id", ignoreDuplicates: true }`, trả về
`{ success, duplicate }`. Client: `player.tsx` sinh UUID ổn định theo LƯỢT PHÁT
(`historyEventIdRef`, reset mỗi track change) và gửi kèm — retry/double-ended
cùng event → 1 row. Tests: 2 cases mới trong `member-data.test.ts`.

### Fix #8 — Leader election hardening

Hai lỗi thật trong reducer cũ:
1. Timeout path tự xưng leader KHÔNG so sánh tabId (hai tab cùng electing → cả
   hai activate).
2. LEADER handler bỏ qua challenger thấp hơn khi `previousLeader === myTabId`
   — dual-leader không tự lành.

Protocol mới (`player-broadcast.ts`):
- Thêm message **CLAIM**: trả lời ELECT để initiator biết mình tham gia.
- State thêm `claimedIds`; **activation chỉ xảy ra khi window đóng**:
  `winner = min(self ∪ claims)` → nếu winner là mình mới `becameLeader=true`;
  ngược lại thành provisional follower ngay lập tức.
- Accept rule của LEADER **monotonic về id thấp nhất**: leader hiện tại (kể cả
  self-activated) nhận LEADER có id thấp hơn ngay trong 1 hop; LEADER id cao
  hơn bị ignore (chống rogue takeover).
- Join path trong `player.tsx` tự claim chính mình khi mở window.

Tests: `player-broadcast.test.ts` viết lại — có case simultaneous-election
chứng minh đúng MỘT activation, case yield-1-hop, rogue-higher rejected,
late-CLAIM ignored.

### Fix #9 — Guest position precision

`writeGuestSession`: `Math.round(s)` → giữ 3 decimals (`Math.round(s*1000)/1000`),
khớp semantics continue-listening với member path (`position_seconds` float).

---

## Finding được ghi nhận nhưng DEFERRED (có lý do)

**#10 Lyrics server-side fan-out** — Đúng là kiến trúc production tốt hơn.
Deferred vì: (a) lyrics search hiện chạy lúc ingestion (Owner-only, tần suất
thấp) chứ không phải hot path người nghe; (b) chuyển fan-out lên server cần
rate-limit/cache layer mới — thuộc scope một PR riêng, không phải vá nóng;
(c) Master Plan §10 chỉ yêu cầu pluggable providers + source tracking, cái đã
đạt. Đã ghi vào "next features" trong AGENT_HANDOFF.

**#12 listUserLibrary payload** — Scale thực tế <1000 tracks (§19.4); playlists
per user nhỏ. Ghi nhận như scalability debt, sẽ cần pagination khi library
tăng materially. Không phải blocker theo chính Master Plan.

**Chronology (#14)** — Xem mục "Migration date convention" trong README:
filename migration là sequence numbers dạng ngày, cố ý vượt mốc lịch để đảm
bảo append-only ordering. Audit trail đã ghi rõ ở 3 chỗ (README, plan.md
banner, handoff).

---

## Cách chạy test độc lập từ ZIP này

```bash
unzip duckroom-source-clean.zip -d duckroom && cd duckroom/repo
npm ci            # nếu timeout, thử: npm ci --no-audit --no-fund --prefer-offline
npx tsc --noEmit  # expect: exit 0
npm test          # expect: 24 files / 293 tests passed
npm run build     # Vite + Nitro/Vercel
npm run scan:secrets  # expect: Clean (70 client files)
```

Lưu ý: suite dùng mocked transports (Supabase/S3/fetch) — nó xác minh LOGIC,
không thay thế external gates (live migrations/RLS matrix/S3).

## Gates sau fix (2026-08-25)

```text
npx tsc --noEmit        PASS (0 errors)
npx eslint .            PASS (0 errors / 19 pre-existing warnings)
npm test                PASS 293/293 across 24 files (was 282)
npm run build           PASS
npm run scan:secrets    CLEAN
Dev smoke               /my-library 200
```
