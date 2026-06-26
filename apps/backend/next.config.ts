import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 保持你原本的設定
  serverExternalPackages: ["@prisma/client", "prisma", "bcrypt"],
  
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          // 開發環境最彈性的作法：直接允許所有來源
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET,DELETE,PATCH,POST,PUT,OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization" },
        ],
      },
    ];
  },
};

export default nextConfig;