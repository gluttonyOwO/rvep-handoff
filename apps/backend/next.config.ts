import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Server-only packages — do not bundle into the browser build.
  serverExternalPackages: ["@prisma/client", "prisma", "bcrypt"],
};

export default nextConfig;
