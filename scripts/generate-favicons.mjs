import fs from "fs";
import path from "path";

const publicDir = path.resolve("./public");
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

// 1. Create crisp vector SVG favicon
const svgFavicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stopColor="#18181b" />
      <stop offset="100%" stopColor="#09090b" />
    </linearGradient>
    <linearGradient id="beak" x1="41" y1="28" x2="56" y2="38" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stopColor="#fb923c" />
      <stop offset="100%" stopColor="#ea580c" />
    </linearGradient>
    <linearGradient id="headphone" x1="14" y1="10" x2="50" y2="36" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stopColor="#fbbf24" />
      <stop offset="100%" stopColor="#d97706" />
    </linearGradient>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#f59e0b" flood-opacity="0.35" />
    </filter>
  </defs>

  <rect width="64" height="64" rx="16" fill="url(#bg)" />
  <rect width="62" height="62" x="1" y="1" rx="15" fill="none" stroke="#27272a" stroke-width="1.5" />

  <g transform="translate(2, 2)">
    <!-- Duck Beak -->
    <path
      d="M41 28C46 28 54 30.5 56 34.5C53.5 38.5 44.5 38 41 37V28Z"
      fill="url(#beak)"
      filter="url(#glow)"
    />

    <!-- Duck Head & Neck -->
    <path
      d="M19 44C19 32 25 19 36 19C42 19 45 23 45 28C45 36 36 39 33 44C31 47 25 50 19 44Z"
      fill="#ffffff"
    />

    <!-- DJ Headphone Band -->
    <path
      d="M20 13C28 8 43 8 49 16"
      stroke="url(#headphone)"
      stroke-width="5.5"
      stroke-linecap="round"
      fill="none"
    />

    <!-- DJ Ear Cup -->
    <rect
      x="14"
      y="21"
      width="10"
      height="16"
      rx="5"
      fill="url(#headphone)"
      filter="url(#glow)"
    />

    <!-- Duck Eye -->
    <circle cx="33" cy="25" r="3" fill="#09090b" />
    <circle cx="34" cy="24" r="1" fill="#ffffff" />
  </g>
</svg>`;

fs.writeFileSync(path.join(publicDir, "favicon.svg"), svgFavicon, "utf-8");

// Web App Manifest
const webManifest = {
  name: "Duckroom",
  short_name: "Duckroom",
  description: "Kho nhạc Lossless & MV bản gốc cá nhân",
  start_url: "/",
  display: "standalone",
  background_color: "#09090b",
  theme_color: "#09090b",
  icons: [
    {
      src: "/favicon.svg",
      sizes: "any",
      type: "image/svg+xml"
    },
    {
      src: "/og-image.jpg",
      sizes: "1200x675",
      type: "image/jpeg"
    }
  ]
};

fs.writeFileSync(path.join(publicDir, "site.webmanifest"), JSON.stringify(webManifest, null, 2), "utf-8");

console.log("Successfully generated favicon.svg and site.webmanifest in public directory");
