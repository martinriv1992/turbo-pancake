import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["sharp", "postgres"],
  experimental: { serverActions: { bodySizeLimit: "25mb" } },
  // Lets the dev server be opened as http://127.0.0.1:<port> as well as localhost.
  allowedDevOrigins: ["127.0.0.1"],
  agentRules: false,
};

export default config;
