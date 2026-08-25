/**
 * Smart Canvas Bounding Box Crop:
 * Automatically detects and crops out solid black letterbox/pillarbox padding
 * burned into the edges of image files (e.g. 1200x800 images with 200px black bars on left/right).
 */
export function cropBlackLetterbox(fileOrUrl: File | string): Promise<string> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") return resolve(typeof fileOrUrl === "string" ? fileOrUrl : "");

    const img = new Image();
    if (typeof fileOrUrl === "string" && (fileOrUrl.startsWith("http://") || fileOrUrl.startsWith("https://"))) {
      img.crossOrigin = "anonymous";
    }

    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(typeof fileOrUrl === "string" ? fileOrUrl : img.src);

        const width = img.naturalWidth || img.width;
        const height = img.naturalHeight || img.height;

        if (!width || !height) return resolve(typeof fileOrUrl === "string" ? fileOrUrl : img.src);

        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0);

        const imgData = ctx.getImageData(0, 0, width, height);
        const data = imgData.data;

        const isBlackPixel = (x: number, y: number) => {
          const idx = (y * width + x) * 4;
          const r = data[idx]!;
          const g = data[idx + 1]!;
          const b = data[idx + 2]!;
          return r < 20 && g < 20 && b < 20;
        };

        // Find top non-black row
        let top = 0;
        for (let y = 0; y < height; y++) {
          let isRowBlack = true;
          for (let x = Math.floor(width * 0.2); x < Math.floor(width * 0.8); x += 6) {
            if (!isBlackPixel(x, y)) {
              isRowBlack = false;
              break;
            }
          }
          if (!isRowBlack) {
            top = y;
            break;
          }
        }

        // Find bottom non-black row
        let bottom = height;
        for (let y = height - 1; y >= 0; y--) {
          let isRowBlack = true;
          for (let x = Math.floor(width * 0.2); x < Math.floor(width * 0.8); x += 6) {
            if (!isBlackPixel(x, y)) {
              isRowBlack = false;
              break;
            }
          }
          if (!isRowBlack) {
            bottom = y + 1;
            break;
          }
        }

        // Find left non-black column
        let left = 0;
        for (let x = 0; x < width; x++) {
          let isColBlack = true;
          for (let y = Math.floor(height * 0.2); y < Math.floor(height * 0.8); y += 6) {
            if (!isBlackPixel(x, y)) {
              isColBlack = false;
              break;
            }
          }
          if (!isColBlack) {
            left = x;
            break;
          }
        }

        // Find right non-black column
        let right = width;
        for (let x = width - 1; x >= 0; x--) {
          let isColBlack = true;
          for (let y = Math.floor(height * 0.2); y < Math.floor(height * 0.8); y += 6) {
            if (!isBlackPixel(x, y)) {
              isColBlack = false;
              break;
            }
          }
          if (!isColBlack) {
            right = x + 1;
            break;
          }
        }

        const croppedWidth = right - left;
        const croppedHeight = bottom - top;

        // Only crop if we detected significant black padding (> 3% of dimension)
        if (
          croppedWidth > 0 &&
          croppedHeight > 0 &&
          (left > width * 0.03 || right < width * 0.97 || top > height * 0.03 || bottom < height * 0.97)
        ) {
          const outCanvas = document.createElement("canvas");
          outCanvas.width = croppedWidth;
          outCanvas.height = croppedHeight;
          const outCtx = outCanvas.getContext("2d");
          if (outCtx) {
            outCtx.drawImage(img, left, top, croppedWidth, croppedHeight, 0, 0, croppedWidth, croppedHeight);
            return resolve(outCanvas.toDataURL("image/jpeg", 0.95));
          }
        }

        resolve(typeof fileOrUrl === "string" ? fileOrUrl : img.src);
      } catch (e) {
        console.warn("Black letterbox crop warning:", e);
        resolve(typeof fileOrUrl === "string" ? fileOrUrl : img.src);
      }
    };

    img.onerror = () => resolve(typeof fileOrUrl === "string" ? fileOrUrl : "");

    if (typeof fileOrUrl === "string") {
      img.src = fileOrUrl;
    } else {
      img.src = URL.createObjectURL(fileOrUrl);
    }
  });
}

export function dataURLtoFile(dataurl: string, filename: string): File {
  const arr = dataurl.split(",");
  const mimeMatch = arr[0]?.match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : undefined;
  const bstr = atob(arr[1] || "");
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new File([u8arr], filename, { ...(mime ? { type: mime } : {}) });
}

/**
 * PERF A2 — Tối ưu kích thước & nén ảnh trước khi tải lên S3:
 * Nếu ảnh gốc có kích thước quá lớn (> 1200px hoặc vài MB),
 * tự động scale về tối đa 1200px và nén JPEG chất lượng 0.85.
 * Giảm dung lượng từ 5-15MB xuống ~200-400KB, tăng tốc độ tải và decode ảnh.
 */
export function compressAndResizeImageFile(
  fileOrUrl: File | string,
  maxDimension = 1200,
  quality = 0.85,
): Promise<{ file: File; dataUrl: string }> {
  return new Promise((resolve) => {
    const filename =
      typeof fileOrUrl === "string" ? `artwork-${Date.now()}.jpg` : fileOrUrl.name.replace(/\.[^/.]+$/, "") + ".jpg";

    if (typeof window === "undefined") {
      const dummyFile = typeof fileOrUrl === "string" ? new File([], filename) : fileOrUrl;
      return resolve({ file: dummyFile, dataUrl: typeof fileOrUrl === "string" ? fileOrUrl : "" });
    }

    const img = new Image();
    if (typeof fileOrUrl === "string" && (fileOrUrl.startsWith("http://") || fileOrUrl.startsWith("https://"))) {
      img.crossOrigin = "anonymous";
    }

    img.onload = () => {
      try {
        let width = img.naturalWidth || img.width;
        let height = img.naturalHeight || img.height;

        if (!width || !height) {
          const fallbackFile = typeof fileOrUrl === "string" ? new File([], filename) : fileOrUrl;
          return resolve({ file: fallbackFile, dataUrl: img.src });
        }

        // Tính tỉ lệ thu nhỏ nếu vượt quá maxDimension
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");

        if (!ctx) {
          const fallbackFile = typeof fileOrUrl === "string" ? new File([], filename) : fileOrUrl;
          return resolve({ file: fallbackFile, dataUrl: img.src });
        }

        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        const compressedFile = dataURLtoFile(dataUrl, filename);

        resolve({ file: compressedFile, dataUrl });
      } catch (err) {
        console.warn("Resize image warning:", err);
        const fallbackFile = typeof fileOrUrl === "string" ? new File([], filename) : fileOrUrl;
        resolve({ file: fallbackFile, dataUrl: typeof fileOrUrl === "string" ? fileOrUrl : img.src });
      }
    };

    img.onerror = () => {
      const fallbackFile = typeof fileOrUrl === "string" ? new File([], filename) : fileOrUrl;
      resolve({ file: fallbackFile, dataUrl: typeof fileOrUrl === "string" ? fileOrUrl : "" });
    };

    if (typeof fileOrUrl === "string") {
      img.src = fileOrUrl;
    } else {
      img.src = URL.createObjectURL(fileOrUrl);
    }
  });
}
