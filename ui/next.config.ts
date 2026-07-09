import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output so the Docker runner stage ships only the server
  // bundle + static assets, mirroring the caipe-ui image layout.
  output: "standalone",

  // Pin the workspace root so stray lockfiles elsewhere on the machine
  // don't confuse Turbopack's root detection.
  turbopack: {
    root: import.meta.dirname,
  },
};

export default nextConfig;
