import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Disabled to avoid double mount of LiveKit Room in dev (causes connect/disconnect storm).
  // Re-enable once we add an idempotent guard for room creation.
  reactStrictMode: false,
};

export default nextConfig;
