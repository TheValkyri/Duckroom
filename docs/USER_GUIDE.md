# 🦆 Duckroom — Hướng dẫn sử dụng

> Bản hướng dẫn đầy đủ mọi tính năng của Duckroom dành cho người nghe (Guest/Member) và chủ kho (Owner). Cập nhật 2026-09-01.

## Mục lục

1. [Tổng quan & vai trò](#1-tổng-quan--vai-trò)
2. [Giao diện & điều hướng](#2-giao-diện--điều-hướng)
3. [Trình phát nhạc (Player)](#3-trình-phát-nhạc-player)
4. [Lời bài hát (Lyrics)](#4-lời-bài-hát-lyrics)
5. [Tìm kiếm](#5-tìm-kiếm)
6. [Kho của tôi (Member)](#6-kho-của-tôi-member)
7. [Tùy chỉnh giao diện (Theme)](#7-tùy-chỉnh-giao-diện-theme)
8. [Chia sẻ](#8-chia-sẻ)
9. [Xem MV](#9-xem-mv)
10. [Trung tâm Tiếp nhận — Upload (Owner)](#10-trung-tâm-tiếp-nhận--upload-owner)
11. [Owner Console](#11-owner-console)
12. [Bảng phím tắt](#12-bảng-phím-tắt)
13. [Mẹo & xử lý sự cố](#13-mẹo--xử-lý-sự-cố)

---

## 1. Tổng quan & vai trò

Duckroom là kho nhạc & MV cá nhân — **lossless-first** (giữ nguyên file gốc, không transcode) và **lyrics-first** (lời đồng bộ là tính năng hạng nhất).

| Vai trò | Có thể làm |
|---|---|
| **Khách (Guest)** | Nghe toàn bộ kho công khai, xem lời, chia sẻ link, đổi theme |
| **Thành viên (Member)** | Như Khách + Yêu thích, Playlists, Lịch sử nghe, Tiếp tục nghe dở, đồng bộ mọi thiết bị |
| **Chủ kho (Owner)** | Như Member + Upload/sửa/xóa media, quản trị hệ thống |

Đăng nhập: **/login** (Email + mật khẩu hoặc Google). Mọi dữ liệu cá nhân chỉ bạn thấy — bảo mật theo chính sách RLS của Supabase.

---

## 2. Giao diện & điều hướng

### 📱 Trên điện thoại

- **Thanh dưới cùng (5 mục):** Trang chủ · Thư viện · Kho của tôi · MV · **Xem thêm**
- **Xem thêm** mở bảng kéo-lên chứa: Albums, Đĩa đơn, Tải lên (Owner), Owner Console — các mục ít dùng không làm chật thanh chính
- **Thanh trên:** logo, nút 🎨 **Giao diện** (theme), và nút tài khoản (đăng nhập/đăng xuất)
- Vuốt thanh dưới lên để mở sheet; vuốt xuống (kéo handle) để đóng

### 🖥️ Trên máy tính

- **Sidebar trái** đầy đủ mọi mục; có thể thu gọn còn icon (nút ở đầu sidebar)
- Nút **Giao diện** nằm cuối sidebar, trên khối tài khoản

---

## 3. Trình phát nhạc (Player)

### Mini Player (thanh dưới)

- **Bố cục chuẩn:** ⏮ Bài trước → ▶️ Phát/Tạm dừng → ⏭ Bài sau
- Chạm vào mini player → mở trình phát toàn màn hình
- Dải mỏng trên đầu = tiến độ (kéo thanh để tua nhanh dùng trình phát đầy)

### Trình phát toàn màn hình

- **Đĩa than xoay** khi phát; dừng đĩa khi tạm dừng
- **Thanh tua** — kéo để tua; thời gian hiện 2 đầu
- **Trộn bài (S)** — trộn ngẫu nhiên thứ tự hàng đợi (bài đang phát giữ vị trí đầu)
- **Lặp lại (R)** — Tắt → Lặp tất cả → Lặp một bài
- **Hàng đợi** — xem/sắp lại thứ tự; trên điện thoại là sheet kéo-lên với nút ↑/↓ từng bài
- **Hẹn giờ tắt nhạc 🌙** (một bên tiêu đề) — chọn 15/30/45/60/90 phút:
  - Badge hiển thị số phút còn lại trên icon
  - **30 giây cuối tự hạ âm lượng êm dần rồi tắt nhạc** — không bao giờ bị "cắt" đột ngột
  - Bấm lại để hủy
- Vuốt màn hình xuống (điện thoại) để thu nhỏ

### Phát kế tiếp

- Mở menu bài hát (nút **⋯** trên điện thoại hoặc nhấn-giữ ~0.5 giây một bài trong danh sách) → **Phát kế tiếp** — bài được chèn vào ngay sau bài đang phát, không ngắt nhạc hiện tại

### Hàng đợi

- Chạm một bài trong hàng đợi để nhảy tới
- Sắp lại: điện thoại dùng nút ↑/↓; máy tính kéo-thả trực tiếp

### Đa tab

Mở nhiều tab cùng Duckroom: hệ thống tự bầu ra **một tab làm "trình phát chính"** — tab khác chỉ hiển thị trạng thái; điều khiển từ tab nào cũng được chuyển về tab chính thực thi.

---

## 4. Lời bài hát (Lyrics)

- Mở bằng nút **Lời** (trình phát đầy đủ) — điện thoại: sheet gần toàn màn hình kéo-lên; máy tính: khung bên phải
- **Dòng đang hát** tô sáng & tự động cuộn giữa màn; chạm dòng nào để tua tới dòng đó
- **Dòng lời đang phát** hiển thị luôn trên trình phát (dưới tên bài) — xem lời mà không cần mở sheet
- Nguồn lời ghi rõ (embedded / LRCLIB / Lyrics.ovh / thủ công)
- Hỗ trợ mọi định dạng LRC phổ biến: `[1:23.45]`, `[00:12.5]`, nhiều timestamp trên một dòng (điệp khúc lặp), tag `[offset:±ms]`

---

## 5. Tìm kiếm

- Vào **Thư viện**, gõ tên bài hoặc nghệ sĩ — kết quả lọc tức thì khi gõ
- Nhấn **Enter** để lưu từ khóa vào **lịch sử tìm kiếm**
- Chạm vào ô tìm kiếm (để trống) → hiện **5 từ khóa gần nhất**; chạm để tìm lại, ✕ để xóa từng mục hoặc "Xóa hết"
- Lọc theo album bằng các nút tròn bên cạnh (Tất cả / Đĩa đơn / từng album)

---

## 6. Kho của tôi (Member)

Đăng nhập để dùng. Gồm:

### Bảng điều khiển đầu trang

- **Thẻ "Nghe tiếp"** — bài dở gần nhất trên mọi thiết bị, hiện vị trí đã lưu; bấm ▶ để phát tiếp từ chỗ đó
- **3 ô thống kê:** số bài yêu thích · số album yêu thích · số playlist

### 4 tab

| Tab | Nội dung |
|---|---|
| **Yêu thích** | Toàn bộ bài đã heart; nút "Phát tất cả" |
| **Album yêu thích** | Lưới album có ≥1 bài được yêu thích — badge ♥ số bài trên mỗi album cho biết độ "thâm niên"; sắp theo nhiều bài thích nhất trước |
| **Playlists** | Tạo (nhập tên → Tạo), phát, mở rộng, đổi tên (✏️), sắp thứ tự (↑/↓ từng bài), thêm bài (nút "+ playlist" trong menu bài hát), xóa — **xóa có Hoàn tác trong 6 giây** |
| **Lịch sử** | 50 lượt nghe gần nhất |

### Yêu thích bài hát

- Nút **♥** trên mỗi bài trong danh sách — đổi màu tức thì (đồng bộ mọi thiết bị)
- Chưa đăng nhập mà bấm ♥ → được mời đăng nhập (dữ liệu không mất)

---

## 7. Tùy chỉnh giao diện (Theme)

Mở bằng nút 🎨 **Giao diện** (thanh trên điện thoại / cuối sidebar máy tính).

- **Chế độ:** Tối / Sáng — chuyển đổi bằng **hiệu ứng sóng nước** lan từ một điểm ngẫu nhiên trên màn hình
- **8 màu nhấn có sẵn:** Vàng đồng · Hổ phách · San hô · Hồng · Tím · Xanh dương · Xanh ngọc · Xanh lục
- **Tự chỉnh:**
  - Thanh **Màu sắc** — track chính là vòng màu thật, kéo để quét toàn dải màu (0-360°)
  - Thanh **Độ đậm** — từ xám tới rực rỡ nhất
  - Màu áp dụng **ngay tức thì** cho toàn app (nút, sóng nhạc, viền...); thả tay mới ghi nhớ
- Tùy chọn được **ghi nhớ trên thiết bị** — mở lại vẫn giữ nguyên

---

## 8. Chia sẻ

- **Bài hát:** menu bài hát (⋯ / nhấn-giữ) → Chia sẻ — tạo link công khai `/s/{token}`; chọn thời hạn: Vĩnh viễn / 30 ngày / 7 ngày / 24 giờ
- **Album & MV:** nút chia sẻ trên trang tương ứng
- Người nhận mở link: xem bìa, tên, nghệ sĩ và nghe thẳng — không cần tài khoản
- Link hết hạn/thu hồi → trang "Liên kết không còn hiệu lực" thân thiện
- Trên điện thoại hỗ trợ chia sẻ native (Zalo/Messenger/...); desktop tự sao chép link vào clipboard

---

## 9. Xem MV

- Trang **MV** hiển thị lưới; MV chưa có ảnh bìa sẽ **tự chụp khung hình đầu** làm preview
- Trên trình phát MV:
  - **Chạm 1 lần** vào màn hình → hiện/ẩn thanh điều khiển (tự ẩn sau ~2.6 giây khi đang phát)
  - **Nhấn giữ đúp** hoặc nút ⛶ → toàn màn hình (video căn giữa chuẩn TV, không mép)
  - Thanh tua 44px, nút Phát / Tiếng / Toàn màn hình — mọi nút đủ lớn cho ngón tay

---

## 10. Trung tâm Tiếp nhận — Upload (Owner)

Vào **Tải lên** (chỉ Owner; khác role bị chuyển hướng).

1. **Chọn/kéo-thả tệp** — hỗ trợ FLAC, WAV, M4A, MP3, MP4, MKV, WebM, MOV; chọn nhiều tệp cùng lúc
2. Hệ thống **phân tích binary thật**: codec / bit-depth / sample rate / thời lượng / SHA-256 — không bao giờ bịa số liệu (không đo được → "Unknown")
3. **Trùng lặp** bị phát hiện qua SHA-256 → chọn "Vẫn tải lên bản sao" / "Hủy mục này"
4. **Duyệt từng mục:** sửa tên bài, nghệ sĩ, album, năm, số thứ tự; đổi/cắt ảnh bìa 1:1; gõ hoặc tìm lời (.LRC) online; **Đồng bộ thủ công** (gõ nhịp theo waveform) cho lời
5. **Sửa hàng loạt:** tích chọn nhiều mục → nhập Nghệ sĩ/Album/Năm áp dụng cho cả loạt; "Chọn tất cả" nhanh
6. **Phê duyệt & Tải lên** — thanh tiến trình từng tệp + banner nổi toàn cục khi ẩn trang; lỗi → nút **Thử lại** từng mục
7. Mọi thay đổi ghi vào PostgreSQL + S3 một cách nguyên tử — lỗi giữa chừng không để lại rác (cleanup tự động)

**Chips trạng thái mục:** Meta / Artwork / Integrity — xanh = đã kiểm, vàng = cảnh báo, đỏ = lỗi.

---

## 11. Owner Console

Trang **Admin** (chỉ Owner) — theo dõi sức khỏe kho:

- Tổng quan: Tracks / Albums / Videos / Users / Playlists / Favorites / History / S3 Objects
- **Quét file rác S3** (orphan) + dọn dẹp có chọn lọc
- **Quét trùng lặp master** (SHA-256)
- Kiểm tra & tạo **snapshot backup** + so khớp drift
- Quản lý **shares** (thu hồi link), **users** (đổi vai trò), **audit log**
- **Spotify bridge:** dán link Spotify → xem metadata khớp local file → xác nhận lưu external identity (không bắt buộc — Spotify chết vẫn nghe bình thường)

---

## 12. Bảng phím tắt

Trên máy tính, nhấn **`?`** (hoặc **Shift + /**) bất kỳ đâu để mở bảng phím tắt:

| Phím | Chức năng |
|---|---|
| `Space` | Phát / Tạm dừng |
| `Shift + →` | Bài kế tiếp |
| `Shift + ←` | Bài trước (hoặc tua lại từ đầu nếu đã phát > 3 giây) |
| `S` | Bật/tắt trộn bài |
| `R` | Lặp lại: Tắt → Tất cả → Một bài |
| `L` | Bật/tắt lời bài hát |
| `Esc` | Thu nhỏ trình phát |
| `?` | Bảng phím tắt này |

*(Các phím trên cũng hoạt động trên màn hình khóa / media keys của bàn phím nhờ MediaSession.)*

---

## 13. Mẹo & xử lý sự cố

| Hiện tượng | Cách xử lý |
|---|---|
| Bài không phát được | Link ký số hết hạn — player tự làm mới; nếu vẫn lỗi, kéo thanh tua một chút để kích hoạt tự chữa |
| Ảnh bìa không hiện | Player tự thử lại từ server;MV chưa có ảnh sẽ tự chụp khung hình đầu |
| Lời lệch nhịp | Lời chỉ hiển thị, không sửa được từ app — báo Owner chỉnh bằng Đồng bộ thủ công lúc upload |
| Đổi thiết bị, quên vị trí nghe | Member: mở Kho của tôi → thẻ "Nghe tiếp" — tự lưu mọi thiết bị |
| Web chậm | Thử thu gọn sidebar (desktop) / tắt trình duyệt tab khác đang phát — chỉ một tab nên làm "trình phát chính" |
| Theme bị reset | Theme lưu theo **thiết bị** (localStorage) — mỗi máy đặt riêng là chủ ý |
| Lỗi 403 khi mở link share | Link đã thu hồi hoặc hết hạn — xin người gửi tạo link mới |

---

*Bản hướng dẫn này đi kèm mã nguồn tại `docs/USER_GUIDE.md` — mọi tính năng có bằng kiểm chứng tự động trong bộ 350+ test.*
