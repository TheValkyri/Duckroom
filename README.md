# Duckroom — Kho Nhạc & MV Lossless Cá Nhân

Ứng dụng web nghe và lưu trữ nhạc FLAC 24-bit, WAV và MV bản gốc cá nhân.

## Công nghệ sử dụng (Tech Stack)

- **Framework**: TanStack Start + React 19 + TypeScript
- **Lưu trữ S3**: Pikamc S3 Storage (Chống nén, hỗ trợ presigned URLs 7 ngày)
- **Xác thực & Phân quyền**: Supabase Auth & Database RLS (`allowed_emails`)
- **Styling**: Tailwind CSS v4 + Motion (Framer Motion)

## Hướng dẫn chạy cục bộ (Development)

Yêu cầu Node.js v20+.

```sh
# Cài đặt dependencies
npm install

# Chạy dev server
npm run dev

# Production Build
npm run build
```
