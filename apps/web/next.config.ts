import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Disabled to avoid double mount of LiveKit Room in dev (causes connect/disconnect storm).
  // Re-enable once we add an idempotent guard for room creation.
  reactStrictMode: false,
// Place it here at the top level!
async headers() {
    return [
      {
        // 匹配你所有的 API 路由
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Credentials", value: "true" },
          { key: "Access-Control-Allow-Origin", value: "*" }, // 正式環境允許所有人連你的 API
          { key: "Access-Control-Allow-Methods", value: "GET,DELETE,PATCH,POST,PUT" },
          { key: "Access-Control-Allow-Headers", value: "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version" },
        ]
      }
    ]
  },
  

};

export default nextConfig;
