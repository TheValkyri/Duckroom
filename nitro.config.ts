import { defineNitroConfig } from "nitro/config";

export default defineNitroConfig({
  preset: "vercel",
  vercel: {
    functions: {
      maxDuration: 60,
      regions: ["sin1"],
    },
  },
  publicAssets: [
    {
      dir: "dist/client",
      maxAge: 31536000,
    },
  ],
  handlers: [
    {
      route: "/**",
      handler: "./dist/server/server.js",
    },
  ],
});
