// Sinh icon PWA 192/512 + maskable từ og-image (một lần, idempotent).
const sharp = require("sharp");

(async () => {
  const src = "public/og-image.jpg";
  for (const size of [192, 512]) {
    const out = `public/icon-${size}x${size}.png`;
    await sharp(src)
      .resize(size, size, { fit: "cover", position: "centre" })
      .png({ quality: 90 })
      .toFile(out);
    console.log("wrote", out);
  }
})();
