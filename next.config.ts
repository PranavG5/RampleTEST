import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Loaded with Node's own resolver so tus-js-client picks its Node build (resumable video uploads).
  serverExternalPackages: ["tus-js-client"],
};

export default nextConfig;
