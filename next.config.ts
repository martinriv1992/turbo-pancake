import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["sharp", "postgres"],
  experimental: { serverActions: { bodySizeLimit: "25mb" } },
};

export default config;
