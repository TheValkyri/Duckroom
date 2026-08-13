# Vault — Web nghe & lưu trữ nhạc lossless (Giai đoạn 1: Front-end / UI)

Xây toàn bộ giao diện và trải nghiệm nghe nhạc trước, chạy bằng dữ liệu mẫu trong code. Chưa nối backend, chưa upload thật — nhưng mọi thứ được dựng sẵn để cắm dữ liệu thật ở giai đoạn 2.

## Hướng thiết kế

- Tông nền tối sâu (near-black xanh mực) + accent hổ phách/đồng ấm, chữ trắng ngà. Sang, tối giản, không tím-gradient kiểu AI.
- Typography: một serif hiện đại cho tiêu đề album/bài, sans hình học cho UI.
- Bo góc vừa, viền mảnh 1px, đổ bóng mềm, hiệu ứng kính mờ ở thanh player.
- Motion: chuyển trang mượt, ảnh bìa "bay" từ lưới sang player (shared layout), sóng nhạc động, lyrics trôi theo dòng, nút bấm có phản hồi vật lý.

## Các màn hình

1. **Trang chủ** — hero album mới nhất, hàng ngang "Albums", "MV", "Nghe gần đây".
2. **Thư viện / Bài hát** — bảng danh sách: số thứ tự, bìa, tên, album, thời lượng, badge chất lượng (FLAC 24/96), nút thích. Tìm kiếm + lọc.
3. **Chi tiết Album** — bìa lớn, nền lấy màu từ ảnh bìa, tracklist, nút Phát / Trộn bài.
4. **Video / MV** — lưới thumbnail, trang xem video toàn khung với player riêng.
5. **Lyrics toàn màn hình** — dòng đang hát nổi bật, các dòng khác mờ dần, tự cuộn; hỗ trợ lyrics có timestamp và lyrics thường.
6. **Trang quản lý (khung sẵn)** — giao diện kéo-thả upload + form metadata, chưa gửi đi đâu.

## Player (thanh cố định dưới, luôn hiện)

- Play/pause, next/prev, thanh tua có xem trước, âm lượng.
- **Trộn bài (shuffle)** — thuật toán Fisher-Yates, giữ hàng đợi ổn định khi bật/tắt.
- **Lặp lại** — tắt / lặp danh sách / lặp một bài.
- Hàng đợi mở được, sắp xếp lại bằng kéo-thả.
- Nút mở lyrics, nút phóng to thành màn hình "Now Playing" (bìa lớn, motion graph sóng nhạc).
- **Motion graph**: phổ tần số vẽ realtime từ Web Audio API AnalyserNode trên canvas.
- Phím tắt: Space, ←/→, S (shuffle), R (repeat), L (lyrics).

## Nguyên tắc chất lượng (ràng buộc xuyên suốt)

- Không bao giờ transcode. `<audio>` phát trực tiếp file gốc; FLAC chạy tốt trên Chrome/Firefox/Edge/Safari 11+.
- Ảnh bìa hiển thị ở độ phân giải gốc, không nén lại phía client.
- Video MV phát nguyên bản; UI hiện rõ codec/bitrate/độ phân giải.

## Kỹ thuật

- TanStack Start + React 19, mỗi màn hình là một route trong `src/routes/`.
- Trạng thái player trong một React context toàn cục đặt ở `__root.tsx` — sống sót qua mọi lần chuyển trang, phát nhạc không đứt.
- Một phần tử `<audio>` duy nhất, dùng lại; nối vào AudioContext cho visualizer.
- Dữ liệu mẫu: `src/data/library.ts` (~12 bài, 3 album, vài MV) đúng kiểu dữ liệu mà backend sẽ trả về sau này — đổi sang API thật chỉ là thay nguồn fetch.
- Toàn bộ màu/font khai báo bằng token trong `src/styles.css`, không hardcode.
- Animation: Motion for React (shared layout cho ảnh bìa, AnimatePresence cho lyrics/overlay).

## Giai đoạn 2 (sau khi duyệt UI — chưa làm lần này)

Bật Lovable Cloud: bảng `albums` / `tracks` / `videos` / `lyrics`, Storage bucket riêng tư cho file gốc + signed URL, upload trực tiếp lên storage (không qua server, không bị bóp), đăng nhập bằng mã mời cho nhóm nhỏ, chỉ bạn có quyền upload.
