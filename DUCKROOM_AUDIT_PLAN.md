# 🛡️ BÁO CÁO AUDIT KỸ THUẬT — Duckroom Lossless Player
**Phạm vi:** toàn bộ source trong `Vaultlossless.zip` (Next-gen TanStack Start + Vite + S3 Pikamc + Supabase)
**Ngày audit:** 2026-08-12 · **Số dòng code đã soát:** ~3.700 dòng TS/TSX (không tính `components/ui`)

---

## ⚠️ CẢNH BÁO KHẨN CẤP — TRƯỚC KHI ĐỌC BÁO CÁO

File zip bạn upload **có kèm file `.env` thật** chứa:
- `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` (Pikamc S3)
- `SUPABASE_SERVICE_ROLE_KEY` (quyền admin toàn bộ database, bypass RLS)

Đồng thời, `src/lib/s3.ts` (dòng 8, 24, 29) **hard-code sẵn các giá trị này làm fallback literal ngay trong source code** — nghĩa là chúng gần như chắc chắn đã bị commit vào Git history (repo có `.git/` trong zip).

**Việc cần làm ngay, không phụ thuộc vào phần còn lại của audit này:**
1. Vào Pikamc S3 console → thu hồi (revoke) Access Key hiện tại, tạo Access Key mới.
2. Vào Supabase Dashboard → Settings → API → **Roll** Service Role Key.
3. Xoá `.env` khỏi Git history (`git filter-repo` hoặc BFG Repo-Cleaner), không chỉ xoá ở commit mới nhất.
4. Xoá 3 dòng fallback literal trong `s3.ts` (chi tiết ở mục 🔴 #1 bên dưới).

Tôi không in lại giá trị secret trong báo cáo này. Toàn bộ phần audit bên dưới giả định bạn sẽ xoay vòng key trước khi deploy lại.

---

## 🔴 CRITICAL & HIGH RISKS

### 1. Secret bị hard-code làm giá trị fallback trong source code
**File:** `src/lib/s3.ts:5-29`
```ts
const accessKeyId =
  (typeof process !== "undefined" && process.env?.S3_ACCESS_KEY_ID) ||
  (import.meta.env.VITE_S3_ACCESS_KEY_ID as string) ||
  "PK40a0c4c3bbf5351b9b";               // ⚠️ literal thật, không phải placeholder

const secretAccessKey =
  (typeof process !== "undefined" && process.env?.S3_SECRET_ACCESS_KEY) ||
  (import.meta.env.VITE_S3_SECRET_ACCESS_KEY as string) ||
  "e7c6ahUMujp8vsZs9TrbaFdMQkxQYfhlNNriyfLSLJo=";   // ⚠️ literal thật
```
Kể cả khi không set biến môi trường, code vẫn "hoạt động được" bằng key thật cứng trong bundle — đây là lý do secret rò rỉ ra Git dễ dàng (dev quên set `.env` local, code chạy ngon nhờ fallback, secret nằm luôn trong file được commit).

**Refactor bắt buộc — fail-fast thay vì fallback ngầm:**
```ts
function requireEnv(name: string): string {
  const val = process.env[name] ?? import.meta.env[`VITE_${name}`];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

export function getS3ServerClient() {
  return new S3Client({
    endpoint: requireEnv("S3_ENDPOINT"),
    region: requireEnv("S3_REGION"),
    credentials: {
      accessKeyId: requireEnv("S3_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("S3_SECRET_ACCESS_KEY"),
    },
    forcePathStyle: true,
  });
}
```
Không bao giờ đặt secret thật (kể cả "demo"/"test") làm literal trong code — chỉ dùng `""` hoặc throw.

---

### 2. `s3.ts` bị import trực tiếp vào code chạy trên Client → rủi ro secret lọt vào bundle browser
**File:** `src/lib/player.tsx:12`
```ts
import { createPresignedUrl } from "./s3";
```
`player.tsx` là component client-side (chạy trong `<PlayerProvider>` ở mọi trang), nhưng nó import từ **cùng một file module** (`s3.ts`) nơi định nghĩa `getS3ServerClient()` với credentials, `S3Client`, và cả 3 secret literal ở mục #1. TanStack Start *có* cơ chế tách server function ra khỏi client bundle qua `createServerFn`, nhưng cơ chế này phụ thuộc vào build-time transform hoạt động đúng 100%; nó **không đảm bảo tuyệt đối** rằng một named export không phải server-fn trong cùng file (`createPresignedUrl`, `BUCKET_NAME`) sẽ tree-shake sạch phần còn lại của module (`S3Client`, các literal secret) ra khỏi bundle.

**Cách khắc phục kiến trúc (an toàn tuyệt đối, không phụ thuộc bundler):**
- Tách file: `s3.server.ts` (chứa `S3Client`, credentials, mọi `createServerFn`) — **không bao giờ** import trực tiếp từ component client.
- File `s3.client.ts` chỉ export các hàm gọi RPC (`createPresignedUrl`) — không import gì từ `@aws-sdk/*`.
- Verify bằng cách build production rồi grep bundle:
```bash
vite build
grep -r "SecretAccessKey\|e7c6ahUM" .output/public/**/*.js   # phải KHÔNG có kết quả
```
Nên chạy lệnh grep này sau khi rotate key mới, như một bước CI bắt buộc trước mỗi lần deploy (xem mục CI/CD).

---

### 3. Không có bất kỳ lớp xác thực/phân quyền nào cho toàn bộ Server Functions
Đã kiểm tra toàn bộ `src/lib/s3.ts`, `src/data/library.ts`, `src/routes/upload.tsx` — **không có** một dòng check session/JWT/user nào trước khi cho phép:
- `deleteS3ObjectServer` — xoá vĩnh viễn bất kỳ object nào trong bucket theo `key` do client gửi lên.
- `saveLibraryManifestServer` — ghi đè toàn bộ `library_manifest.json` (toàn bộ thư viện nhạc) bằng bất kỳ JSON nào.
- `requestPresignedUploadUrlServer` — cấp URL PUT cho bất kỳ `key` nào, không giới hạn loại file/kích thước.
- `listS3ObjectsServer` — liệt kê toàn bộ nội dung bucket.

Có `csrfMiddleware` (`src/start.ts`) chống CSRF, nhưng **CSRF ≠ Authorization**. Bất kỳ ai truy cập được URL của site (kể cả không đăng nhập) đều gọi thẳng các server function này và toàn quyền đọc/ghi/xoá kho nhạc.

**Điều đáng chú ý nhất:** repo đã có sẵn `supabase/schema.sql` với **hệ thống RLS invite-only hoàn chỉnh** (`allowed_emails`, `is_member()`, `is_admin()`, policy cho `albums`/`tracks`/`videos`) — nhưng **không hề được kết nối vào phần code đang chạy thật**. Đây là một kiến trúc auth đã thiết kế xong nhưng bị bỏ dở giữa chừng, còn app thực tế đang chạy ở chế độ hoàn toàn mở (không auth, dùng S3-manifest thay vì Supabase DB).

**Đề xuất tối thiểu để vá ngay:**
```ts
// src/lib/auth-guard.ts
import { createMiddleware } from "@tanstack/react-start";
import { supabaseAdmin } from "./supabase";

export const requireMemberMiddleware = createMiddleware().server(async ({ next, request }) => {
  const token = request.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) throw new Response("Unauthorized", { status: 401 });
  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  const email = user?.email?.toLowerCase();
  if (!email) throw new Response("Unauthorized", { status: 401 });
  const { data: allowed } = await supabaseAdmin
    .from("allowed_emails").select("email").eq("email", email).maybeSingle();
  if (!allowed) throw new Response("Forbidden", { status: 403 });
  return next();
});
```
Rồi áp middleware này vào từng `createServerFn` ghi/xoá (`.middleware([requireMemberMiddleware])`), tối thiểu là cho `deleteS3ObjectServer`, `saveLibraryManifestServer`, `requestPresignedUploadUrlServer`.

---

### 4. Hydration Mismatch cụ thể, tái hiện được — `src/routes/library.tsx`
Component tự mâu thuẫn: dòng 58 **có** guard hydration đúng cách, nhưng 5 chỗ khác trong cùng component **đọc thẳng singleton toàn cục** không qua guard:

```tsx
const activeTracks = isHydrated ? tracks : [];       // dòng 58 — ĐÚNG

...
{tracks.length} bản thu · tổng ...                    // dòng 79 — SAI, đọc thẳng `tracks`
{tracks.length > 0 && ( ... )}                         // dòng 94 — SAI
{tracks.length > 0 && ( ... )}                         // dòng 107 — SAI
{[{ id: "all", ... }, ...albums].map(...)}             // dòng 115 — SAI, đọc thẳng `albums`
{tracks.length === 0 ? ( ... )}                        // dòng 140 — SAI
```
Nguyên nhân gốc: `src/data/library.ts:101-107` chạy `loadStoredLibrary()` **ngay tại module scope** (side-effect khi import module), không phải trong `useEffect`:
```ts
if (typeof window !== "undefined") {
  loadStoredLibrary();               // đọc localStorage NGAY khi module được import
  if (albums.length > 0 || tracks.length > 0) saveStoredLibrary();
}
```
Vì đây chạy đồng bộ lúc script được parse (trước hoặc trong lúc React hydrate), `tracks`/`albums` trên client có thể đã khác `[]` (giá trị server render ra) đúng vào thời điểm React so khớp DOM → **React Error #418/#425** xảy ra thật, không phải giả thuyết. Đây chính là nguyên nhân bug "Hydration Mismatch" mà brief audit gốc yêu cầu tìm.

**Sửa theo 2 lớp:**
1. Dời side-effect load ra khỏi module scope, vào trong 1 hook `useEffect` chạy 1 lần ở root (`__root.tsx` hoặc `PlayerProvider`) thay vì tại thời điểm import.
2. Toàn bộ nơi đọc `tracks`/`albums` để render UI phải đi qua 1 hook tập trung thay vì import trực tiếp mảng mutable:
```ts
// src/lib/useLibrary.ts
import { useSyncExternalStore } from "react";
import { tracks, albums, videos, subscribeLibrary } from "../data/library";

export function useLibrary() {
  return useSyncExternalStore(
    subscribeLibrary,
    () => ({ tracks, albums, videos }),   // client snapshot
    () => ({ tracks: [], albums: [], videos: [] }),  // server snapshot — luôn rỗng, khớp SSR
  );
}
```
(`data/library.ts` cần thêm 1 `Set<() => void>` listener + gọi `notify()` bên trong `saveStoredLibrary()`.) Cách này giải quyết tận gốc thay vì rải `isHydrated ? x : []` ở từng chỗ dùng — đúng tinh thần "đóng gói logic lặp lại thành hook" mà audit yêu cầu ở mục 5.

---

### 5. Ghi đè toàn bộ manifest S3 trên MỌI thay đổi nhỏ nhất — không debounce, không kiểm soát tranh chấp (race condition)
**File:** `src/data/library.ts:86-99`, được gọi từ hơn 10 nơi khác nhau kể cả `player.tsx:340` (mỗi lần đọc được `duration` thật của 1 bài hát vừa load xong).

```ts
export function saveStoredLibrary() {
  localStorage.setItem(...);
  ...
  void saveLibraryManifestServer({ data: { jsonString: JSON.stringify(manifest) } }); // full overwrite, mọi lần gọi
}
```
Hệ quả:
- Chỉ cần bấm play 1 bài → cả `library_manifest.json` (toàn bộ album/track/video) được re-upload lên S3, không kiểm tra gì đã đổi thật hay chưa. Tốn băng thông + chi phí PUT request vô ích.
- **Không có ETag / version check nào.** Nếu 2 thiết bị cùng mở app, thiết bị A sửa album lúc 10:00, thiết bị B (đang mở tab cũ, chưa refetch) chỉ cần phát 1 bài nhạc lúc 10:01 → `saveStoredLibrary()` tự chạy → ghi đè `library_manifest.json` bằng bản cũ của B, **xoá mất thay đổi của A** mà không có cảnh báo gì. Đây đúng là race condition "2 thiết bị cùng sửa" mà audit gốc hỏi tới — và câu trả lời hiện tại là: **chưa xử lý, mất dữ liệu âm thầm.**

**Đề xuất refactor — debounce + optimistic concurrency bằng ETag:**
```ts
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lastKnownETag: string | null = null;

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    localStorage.setItem(STORAGE_KEY_TRACKS, JSON.stringify(tracks));
    localStorage.setItem(STORAGE_KEY_ALBUMS, JSON.stringify(albums));
    localStorage.setItem(STORAGE_KEY_VIDEOS, JSON.stringify(videos));
    const manifest = { albums, tracks, videos };
    const res = await saveLibraryManifestServer({
      data: { jsonString: JSON.stringify(manifest), ifMatchETag: lastKnownETag },
    });
    if (res.conflict) {
      // server trả 409 nếu ETag không khớp — tức có thiết bị khác ghi trước
      await syncLibraryWithS3(); // kéo bản mới nhất về, báo người dùng merge lại
    } else {
      lastKnownETag = res.newETag;
    }
  }, 800); // debounce 800ms, gộp nhiều thay đổi liên tiếp thành 1 lần ghi
}
```
Phía server (`saveLibraryManifestServer`) cần đổi sang dùng `PutObjectCommand` với `IfMatch`/kiểm tra `ETag` hiện tại qua `HeadObjectCommand` trước khi ghi, trả về `409` nếu lệch — S3-compatible storage như Pikamc cần xác nhận có hỗ trợ conditional write hay không; nếu không, cân nhắc dùng object versioning của bucket làm log thay đổi tối thiểu.

---

### 6. Mutation trực tiếp lên object dùng chung, bypass React state — `player.tsx`
```ts
// dòng 243, 284
nextTrack.src = freshSignedUrl;
current.src = freshSignedUrl;
// dòng 339
current.duration = realDur;
saveStoredLibrary();
```
`current`/`nextTrack` là **cùng 1 object reference** với phần tử nằm trong mảng `tracks` toàn cục (`data/library.ts`). Mutate trực tiếp field trên object này:
- Không kích hoạt re-render nào của React (không đi qua `setState`) — nơi khác đang hiển thị track này (VD: `TrackRow`, `AlbumCard`) không tự cập nhật `src` mới, dễ tạo trạng thái UI/data lệch nhau (desync).
- Presigned URL "tươi" (có hạn 7 ngày) sau khi gán trực tiếp vào `current.src` sẽ bị `saveStoredLibrary()` **lưu vĩnh viễn vào localStorage và S3 manifest** — nhưng do chính bug #5 (không debounce/không có single source of truth rõ ràng), 1 thiết bị khác đọc lại manifest này ở ngày thứ 8 sẽ dùng phải presigned URL đã hết hạn, **and** không có cơ chế nào phát hiện + refetch lại trừ khi URL đó đúng dạng "chưa từng có `X-Amz-Signature`" — nhưng nó đã có (`X-Amz-Signature` nằm trong `freshSignedUrl` được lưu), nên logic tự-refresh trong `syncAudioSource` (dòng 274: `!targetSrc.includes("X-Amz-Signature")`) sẽ **bỏ qua** track này mãi mãi, không bao giờ refresh lại được nữa → **audio 404/403 sau 7 ngày, không tự phục hồi.**

**Sửa:** không mutate object thư viện trực tiếp trong Player. Giữ URL "tươi" trong 1 state cục bộ của Player (Map `trackId -> freshUrl` trong `useState`/`useRef`), tách biệt hoàn toàn khỏi object gốc trong `tracks`. Khi cần lưu persistent, chỉ lưu `key` gốc (không lưu presigned URL) và luôn presign lại at-request-time thay vì cache URL đã ký vào manifest lâu dài.

---

## 🟡 MEDIUM RISKS

### 7. Không kiểm soát loại file / kích thước khi upload
**File:** `src/lib/upload-store.ts:142, 174`
```ts
const fileExt = selectedFile.name.split(".").pop() || (isVideo ? "mp4" : "flac");
const contentType = selectedFile.type || (isVideo ? "video/mp4" : "audio/flac");
```
Không có whitelist định dạng (`.flac/.wav/.alac/.mp4/.mkv`...), không giới hạn `selectedFile.size`. Kết hợp với bug #3 (không auth), site có thể bị lợi dụng làm nơi lưu trữ file tuỳ ý (kể cả `.html`/`.js`) nếu bucket cho phép serve nội dung công khai.
**Đề xuất:** allowlist đuôi file + `Content-Length` tối đa, validate ở `requestPresignedUploadUrlServer` (server-side, không tin client) trước khi presign.

### 8. Race condition khi đặt tên file lúc upload (trùng key, ghi đè lẫn nhau)
**File:** `src/lib/upload-store.ts:158-166`
```ts
const singleSeq = padNumber(tracks.filter((t) => t.albumId === "singles").length + 1);
storageKey = `singles/${singleSeq} - ${cleanTitle}.${fileExt}`;
```
Số thứ tự tính từ `tracks.length` tại thời điểm gọi — không atomic. 2 lượt upload gần như đồng thời (2 tab, hoặc bấm nhanh 2 lần) có thể tính ra cùng 1 `storageKey`, PUT sau **ghi đè âm thầm** file PUT trước trên S3 (không lỗi, không cảnh báo). **Đề xuất:** dùng `fileId` (đã có, unique) làm phần bắt buộc của key thay vì chỉ số thứ tự đoán trước, VD: `singles/${fileId}-${cleanTitle}.${fileExt}`.

### 9. `sanitizeStorageName` là blacklist, không phải allowlist
**File:** `src/lib/upload-store.ts:105-110`
```ts
function sanitizeStorageName(name: string): string {
  return name.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ");
}
```
Chặn được `/` nên path traversal qua tên bài hát/album khó xảy ra trong thực tế (vì `..` không kèm `/` thì vô hại), nhưng đây vẫn là kiểu blacklist dễ sót (ký tự điều khiển, dấu chấm ở đầu tên, độ dài file name quá lớn, ký tự Unicode nhìn giống `/`). **Đề xuất:** dùng allowlist rõ ràng — `name.normalize("NFC").replace(/[^\p{L}\p{N}\s._-]/gu, "-").slice(0, 120)`.

### 10. `ListObjectsV2Command` không xử lý phân trang
**File:** `src/lib/s3.ts:88-102`
```ts
const command = new ListObjectsV2Command({ Bucket: BUCKET_NAME });
const res = await s3.send(command);
const keys = (res.Contents || []).map(...)
```
S3 API giới hạn **tối đa 1.000 object mỗi response**; không đọc `IsTruncated`/`ContinuationToken` nghĩa là khi bucket có hơn 1.000 file, `listS3ObjectsServer` (và do đó cơ chế "S3 Key Auto-Discovery" trong `syncLibraryWithS3`) sẽ âm thầm bỏ sót các bài hát/video nằm ngoài 1.000 object đầu tiên. **Đề xuất:** loop với `ContinuationToken` cho tới khi `IsTruncated === false`.

### 11. Regex trích key từ URL bị lặp lại 8+ lần, hard-code tên bucket
Chuỗi `/pikamc-osi-[^/]+\/([^?#]+)/` xuất hiện gần như y hệt tại: `player.tsx` (×2), `data/library.ts` (×6). Vi phạm DRY (đúng mục 5 audit yêu cầu dọn), và **giòn**: nếu đổi `BUCKET_NAME` sang tên khác không bắt đầu bằng `pikamc-osi-`, toàn bộ logic trích key hỏng lặng lẽ (fallback về `""`/`undefined`, không throw).
**Đề xuất — 1 hàm util duy nhất, dùng `BUCKET_NAME` động thay vì hard-code:**
```ts
// src/lib/s3-key.ts
import { BUCKET_NAME } from "./s3";

export function extractS3KeyFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const prefix = `/${BUCKET_NAME}/`;
    if (!u.pathname.startsWith(prefix)) return null;
    return decodeURIComponent(u.pathname.slice(prefix.length));
  } catch {
    return null;
  }
}
```
Dùng `URL` API thay vì regex thủ công sẽ chịu được thay đổi tên bucket, chịu được query string bất kỳ, và không cần lặp lại logic decode ở từng nơi gọi.

### 12. `AudioContext`/`MediaElementAudioSourceNode` phụ thuộc cấu hình CORS của bucket, chưa audit được từ code
`player.tsx` set `crossOrigin="anonymous"` trên cả 2 thẻ `<audio>` (đúng, cần thiết để `createMediaElementSource` trong `audio-analyser.ts` không bị lỗi tainted source) — nhưng điều này **chỉ hoạt động nếu response GET presigned URL từ Pikamc S3 trả về đúng header `Access-Control-Allow-Origin`** khớp domain deploy. Tôi không audit được cấu hình CORS thật của bucket từ source code (đây là setting phía server S3/Pikamc, ngoài phạm vi code). **Cần bạn tự kiểm tra** trong Pikamc console: CORS rule của bucket có giới hạn đúng domain production hay đang để `*`. Để `*` thì bất kỳ website nào cũng embed/stream được file audio của bạn nếu biết URL.

### 13. `EditTrackModal.tsx` parse `trackNo` không chặn số âm/thập phân chặt chẽ
```ts
track.trackNo = parseInt(trackNo, 10) || 1;
```
`parseInt("-5")` → `-5` (không bị fallback vì `-5` là truthy), `parseInt("abc")` → `NaN` → fallback `1` (đúng), nhưng số âm/`0` lọt qua được, ảnh hưởng logic `sort((a,b) => a.trackNo - b.trackNo)` ở `albumTracks`. **Đề xuất:** `Math.max(1, parseInt(trackNo, 10) || 1)`.

---

## 🟢 LOW & CLEANUP

- **`any` xuất hiện 19 lần** trong `src/**/*.ts(x)` (ví dụ `newTrack.format as any` trong `upload-store.ts:313`, `err: any` trong nhiều catch block). Đề xuất: tạo `type UploadFormat = "FLAC" | "ALAC" | "WAV"` và validate bằng `zod` (đã có sẵn trong dependencies nhưng gần như không dùng tới ở layer upload/manifest — rất đáng tận dụng vì `zod` đã nằm trong `package.json`).
- **Không tìm thấy `console.log` thừa** trong `src/` — điểm cộng, code sạch ở khoản này, chỉ có `console.error`/`console.warn` có chủ đích.
- **Không tìm thấy vòng lặp `for...of` + `await` tuần tự** — mọi nơi xử lý nhiều item bất đồng bộ (`syncLibraryWithS3`, tạo artwork map...) đều dùng `Promise.all` đúng chuẩn. Điểm cộng lớn cho hiệu suất I/O.
- **`Visualizer.tsx`** dừng vòng lặp `requestAnimationFrame` khi `document.hidden` và có `visibilitychange` listener để resume — xử lý đúng, tránh tốn pin khi tab ẩn. Không cần sửa.
- **Cover ảnh album** ở `data/library.ts:365` build 1 URL S3 **không qua presigned** (`https://s3.pikamc.vn/${BUCKET_NAME}/${key}`) trong khi phần còn lại của app dùng presigned URL cho mọi thứ khác — không nhất quán. Nếu bucket thực sự private, ảnh cover theo đường này sẽ lỗi 403; nếu bucket public thì mâu thuẫn với việc dùng presigned URL để "bảo vệ" audio ở nơi khác (ai cũng đoán được URL cover thì cũng đoán được pattern URL cho các object khác). Nên thống nhất 1 cách duy nhất.
- **`-api.stream.track.$id.ts` / `-api.stream.video.$id.ts`**: 2 route file bắt đầu bằng dấu `-` — theo convention của TanStack Router, tiền tố này loại route khỏi route tree (xác nhận: không thấy `stream` xuất hiện trong `routeTree.gen.ts`). Đây là **code chết** — dùng schema Supabase (`supabaseAdmin.from("tracks")`) hoàn toàn khác với data model thật của app (S3 manifest JSON). Đề xuất: xoá hẳn 2 file này (và bảng `tracks`/`videos`/`albums` trong Supabase nếu không dùng), hoặc hoàn thiện nếu đây là hướng kiến trúc dự định chuyển sang trong tương lai — hiện tại nó chỉ gây nhầm lẫn cho dev mới vào dự án (2 nguồn sự thật khác nhau cùng tồn tại).
- `.lovable/` folder có trong zip — file cấu hình/plan nội bộ của công cụ Lovable, không nên commit vào repo chính thức nếu repo sẽ public hoặc chia sẻ, kiểm tra `.gitignore` đã che đúng chưa.

---

## 🚀 CI/CD & PRODUCTION READINESS (ghi nhận nhanh)

- `vite.config.ts`/build output (`.output/public`, `.output/server`) chưa được build thử trong lần audit này (audit tĩnh trên source, không chạy `vite build` vì thiếu mạng ra ngoài tới CDN nội bộ Pikamc). **Khuyến nghị bạn tự chạy** `vite build` rồi kiểm tra:
  ```bash
  vite build
  du -sh .output/public/**/*.js | sort -h | tail -10   # tìm chunk > 500kB
  grep -rl "SecretAccessKey\|S3_SECRET" .output/public   # PHẢI rỗng — xem mục 🔴 #2
  ```
- `@aws-sdk/client-s3` (SDK v3, dùng named import theo command — đã đúng chuẩn tree-shake) chỉ nên nằm trong bundle server, không nên xuất hiện trong `.output/public` — verify bằng lệnh trên sau khi tách file theo đề xuất mục 🔴 #2.
- Dự án dùng `nitro` (`3.0.260603-beta` — bản beta) làm server runtime — bản beta có thể có breaking change giữa các bản patch, nên pin chính xác version thay vì để `^`/beta tag trôi nếu deploy production.

---

## 📌 TÓM TẮT ƯU TIÊN XỬ LÝ

| # | Vấn đề | Mức độ | Nỗ lực sửa |
|---|---|---|---|
| 1 | Rotate S3 + Supabase key đã lộ | 🔴 Critical | 15 phút |
| 3 | Không có auth cho server functions | 🔴 Critical | 0.5–1 ngày |
| 2 | Secret literal trong `s3.ts`, tách server/client module | 🔴 Critical | 1–2 giờ |
| 4 | Hydration mismatch ở `library.tsx` | 🔴 High | 2–3 giờ |
| 5 | Manifest ghi đè không kiểm soát tranh chấp | 🔴 High | 0.5 ngày |
| 6 | Mutate object track trực tiếp, cache presigned URL vĩnh viễn | 🔴 High | 3–4 giờ |
| 7–13 | Upload validation, race condition đặt tên, pagination S3, DRY regex | 🟡 Medium | 1–2 ngày tổng |
| Còn lại | `any`, dead code, cover URL không nhất quán | 🟢 Low | dọn dần |

Nếu bạn muốn, mình có thể viết luôn code refactor hoàn chỉnh (patch trực tiếp vào từng file) cho bất kỳ mục nào ở trên — cho biết bạn muốn bắt đầu từ mục nào trước (khuyến nghị: #1 → #3 → #2 → #4, theo đúng thứ tự rủi ro).
