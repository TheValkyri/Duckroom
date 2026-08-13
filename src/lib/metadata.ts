/**
 * Tự động trích xuất Cover Art từ file .FLAC / .MP3 và Thumbnail từ file Video (MV)
 */

export async function extractAudioCover(file: File): Promise<string | null> {
  try {
    const buffer = await file.slice(0, 15 * 1024 * 1024).arrayBuffer(); // read first 15MB
    const view = new DataView(buffer);

    // 1. Kiểm tra FLAC magic bytes 'fLaC' (0x66 0x4C 0x61 0x43)
    if (
      view.getUint8(0) === 0x66 &&
      view.getUint8(1) === 0x4c &&
      view.getUint8(2) === 0x61 &&
      view.getUint8(3) === 0x43
    ) {
      let offset = 4;
      let isLast = false;

      while (offset < view.byteLength - 4 && !isLast) {
        const headerByte = view.getUint8(offset);
        isLast = (headerByte & 0x80) !== 0;
        const blockType = headerByte & 0x7f;

        const length =
          (view.getUint8(offset + 1) << 16) |
          (view.getUint8(offset + 2) << 8) |
          view.getUint8(offset + 3);

        offset += 4;

        if (blockType === 6) {
          // Metadata Block PICTURE
          let pOffset = offset;
          pOffset += 4; // picture type

          const mimeLen = view.getUint32(pOffset);
          pOffset += 4;

          const mimeBytes = new Uint8Array(buffer, pOffset, mimeLen);
          const mime = new TextDecoder().decode(mimeBytes) || "image/jpeg";
          pOffset += mimeLen;

          const descLen = view.getUint32(pOffset);
          pOffset += 4 + descLen;

          pOffset += 16; // width, height, depth, colors

          const imgLen = view.getUint32(pOffset);
          pOffset += 4;

          const imgBytes = new Uint8Array(buffer, pOffset, imgLen);
          const blob = new Blob([imgBytes], { type: mime });
          return URL.createObjectURL(blob);
        }

        offset += length;
      }
    }

    // 2. Kiểm tra ID3v2 Header ('ID3')
    if (view.getUint8(0) === 0x49 && view.getUint8(1) === 0x44 && view.getUint8(2) === 0x33) {
      const tagSize =
        ((view.getUint8(6) & 0x7f) << 21) |
        ((view.getUint8(7) & 0x7f) << 14) |
        ((view.getUint8(8) & 0x7f) << 7) |
        (view.getUint8(9) & 0x7f);

      let offset = 10;
      while (offset < tagSize + 10 && offset < view.byteLength - 10) {
        const frameId = String.fromCharCode(
          view.getUint8(offset),
          view.getUint8(offset + 1),
          view.getUint8(offset + 2),
          view.getUint8(offset + 3),
        );
        const frameSize = view.getUint32(offset + 4);
        offset += 10;

        if (frameId === "APIC") {
          const encoding = view.getUint8(offset);
          let mimeEnd = offset + 1;
          while (view.getUint8(mimeEnd) !== 0 && mimeEnd < offset + frameSize) mimeEnd++;
          const mime =
            new TextDecoder().decode(new Uint8Array(view.buffer, offset + 1, mimeEnd - offset - 1)) ||
            "image/jpeg";

          let imgStart = mimeEnd + 2;
          if (encoding === 0 || encoding === 3) {
            while (view.getUint8(imgStart) !== 0 && imgStart < offset + frameSize) imgStart++;
            imgStart += 1;
          } else {
            imgStart += 2;
          }

          const imgLen = frameSize - (imgStart - offset);
          const imgBytes = new Uint8Array(view.buffer, imgStart, imgLen);
          const blob = new Blob([imgBytes], { type: mime });
          return URL.createObjectURL(blob);
        }

        offset += frameSize;
      }
    }
  } catch (err) {
    console.warn("Cover extraction error:", err);
  }
  return null;
}

export function extractVideoThumbnail(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.src = URL.createObjectURL(file);
    video.muted = true;
    video.playsInline = true;

    video.onloadedmetadata = () => {
      video.currentTime = Math.min(1.0, video.duration / 2);
    };

    video.onseeked = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth || 1280;
        canvas.height = video.videoHeight || 720;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
          URL.revokeObjectURL(video.src);
          resolve(dataUrl);
          return;
        }
      } catch (err) {
        console.warn("Video thumbnail error:", err);
      }
      URL.revokeObjectURL(video.src);
      resolve(null);
    };

    video.onerror = () => {
      URL.revokeObjectURL(video.src);
      resolve(null);
    };
  });
}
