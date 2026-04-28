import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: {
    root: repoRoot
  },
  experimental: {
    proxyClientMaxBodySize: "25mb"
  }
};

export default nextConfig;
