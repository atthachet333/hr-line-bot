import type { NextConfig } from "next";

console.log("========================================");
console.log("🚀 Starting HR LINE Bot Server...");
console.log("🌐 Target Port: 3333");
console.log("========================================");

const nextConfig: NextConfig = {
  // Generate static pages in-process (no worker fan-out) so `next build` does
  // not OOM on memory-constrained hosts during static-page generation.
  experimental: {
    workerThreads: false,
    cpus: 1,
  },

  // 1. อนุญาตให้ ngrok เข้าถึงระบบ
  allowedDevOrigins: [
    "hear-sponsored-colon-phoenix.trycloudflare.com"
  ],
  
  // 2. ส่งบัตรผ่าน VIP ไปให้ ngrok ปล่อยผ่านไฟล์ CSS ทันที
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "ngrok-skip-browser-warning",
            value: "true",
          },
        ],
      },
    ];
  },
};

export default nextConfig;