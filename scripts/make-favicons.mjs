import fs from "fs";
import path from "path";
import sharp from "sharp";

const publicDir = path.resolve("./public");
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

// Exact ModernDuckLogo SVG with high contrast colors and crisp rendering
const duckSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40" fill="none">
  <defs>
    <linearGradient id="duck-beak-grad" x1="26" y1="18" x2="35" y2="24" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#fb923c" />
      <stop offset="100%" stop-color="#ea580c" />
    </linearGradient>
    <linearGradient id="duck-phone-grad" x1="9" y1="5" x2="31" y2="23" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#fbbf24" />
      <stop offset="100%" stop-color="#d97706" />
    </linearGradient>
  </defs>
  <!-- Duck Beak -->
  <path
    d="M26 18C29 18 34 19.5 35 22C33.5 24.5 28 24 26 23.5V18Z"
    fill="url(#duck-beak-grad)"
  />
  <!-- Duck Head & Neck -->
  <path
    d="M12 28C12 20 16 12 23 12C26.5 12 28.5 14.5 28.5 18C28.5 23 23 25 21 28C19.5 30 16 32 12 28Z"
    fill="#ffffff"
  />
  <!-- DJ Headphone Band -->
  <path
    d="M13 8C18 5 27 5 31 10"
    stroke="url(#duck-phone-grad)"
    stroke-width="3.5"
    stroke-linecap="round"
  />
  <!-- DJ Ear Cup -->
  <rect
    x="9"
    y="13"
    width="6"
    height="10"
    rx="3"
    fill="url(#duck-phone-grad)"
  />
  <!-- Duck Eye -->
  <circle cx="21" cy="16" r="2" fill="#09090b" />
</svg>`;

// Write favicon.svg
fs.writeFileSync(path.join(publicDir, "favicon.svg"), duckSvg, "utf-8");

// Generate PNGs using sharp
const svgBuffer = Buffer.from(duckSvg);

async function generateIcons() {
  const png32 = await sharp(svgBuffer, { density: 300 }).resize(32, 32).png().toBuffer();

  const png16 = await sharp(svgBuffer, { density: 300 }).resize(16, 16).png().toBuffer();

  const png180 = await sharp(svgBuffer, { density: 300 }).resize(180, 180).png().toBuffer();

  fs.writeFileSync(path.join(publicDir, "favicon-32x32.png"), png32);
  fs.writeFileSync(path.join(publicDir, "favicon.png"), png32);
  fs.writeFileSync(path.join(publicDir, "apple-touch-icon.png"), png180);

  // Build valid ICO file embedding 32x32 and 16x16 PNGs
  // ICO header: 6 bytes
  // Directory entries: 16 bytes per image (2 images = 32 bytes)
  // Image data: png16 then png32
  const numImages = 2;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // Reserved
  header.writeUInt16LE(1, 2); // Type 1 = ICO
  header.writeUInt16LE(numImages, 4); // Number of images

  const offset1 = 6 + 16 * numImages;
  const offset2 = offset1 + png16.length;

  const dirEntry1 = Buffer.alloc(16);
  dirEntry1.writeUInt8(16, 0); // width
  dirEntry1.writeUInt8(16, 1); // height
  dirEntry1.writeUInt8(0, 2); // color count
  dirEntry1.writeUInt8(0, 3); // reserved
  dirEntry1.writeUInt16LE(1, 4); // color planes
  dirEntry1.writeUInt16LE(32, 6); // bpp
  dirEntry1.writeUInt32LE(png16.length, 8); // size
  dirEntry1.writeUInt32LE(offset1, 12); // offset

  const dirEntry2 = Buffer.alloc(16);
  dirEntry2.writeUInt8(32, 0); // width
  dirEntry2.writeUInt8(32, 1); // height
  dirEntry2.writeUInt8(0, 2); // color count
  dirEntry2.writeUInt8(0, 3); // reserved
  dirEntry2.writeUInt16LE(1, 4); // color planes
  dirEntry2.writeUInt16LE(32, 6); // bpp
  dirEntry2.writeUInt32LE(png32.length, 8); // size
  dirEntry2.writeUInt32LE(offset2, 12); // offset

  const icoBuffer = Buffer.concat([header, dirEntry1, dirEntry2, png16, png32]);
  fs.writeFileSync(path.join(publicDir, "favicon.ico"), icoBuffer);

  console.log("Successfully generated all favicon formats (.ico, .svg, .png, apple-touch-icon)!");
}

generateIcons().catch(console.error);
