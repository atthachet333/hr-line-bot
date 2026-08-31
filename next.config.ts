import type { NextConfig } from "next";
import { fileURLToPath } from "url";
import path from "path";
import { liffRedirects } from "./lib/liff/redirects";

console.log("========================================");
console.log("🚀 Starting HR LINE Bot Server...");
console.log("🌐 Target Port: 3333");
console.log("========================================");

// Absolute project directory. Pinning the file-tracing root here keeps the
// output-file tracer bounded to this project and prevents it from ever walking
// up toward the drive root on this Windows host.
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

// Non-runtime paths that must never be pulled into a route's file-trace. The
// evidence routes read files from an EXTERNAL, env-configured directory
// (LEAVE_EVIDENCE_DIR, outside the repo) at request time; because that path is
// only known at runtime, the tracer cannot resolve it statically and otherwise
// falls back to tracing the whole project. These globs (docs, generated/config
// assets, tests, tooling scripts — all already excluded from the compiled
// output) are safe to drop: the app is served with `next start` from the full
// repo, so the .nft.json trace files are advisory and never loaded at runtime.
const TRACE_NOISE = [
  "**/*.md",
  "docs/**/*",
  "google-apps-script/**/*",
  "config/**/*",
  "tests/**/*",
  "scripts/**/*",
  "coverage/**/*",
  ".next/cache/**/*",
];

const nextConfig: NextConfig = {
  // Generate static pages in-process (no worker fan-out) so `next build` does
  // not OOM on memory-constrained hosts during static-page generation.
  experimental: {
    workerThreads: false,
    cpus: 1,
  },

  // Bound output file tracing to this project directory.
  outputFileTracingRoot: projectRoot,

  // Trim the file-trace for the evidence-storage routes. Their runtime
  // filesystem access targets the external LEAVE_EVIDENCE_DIR, never these
  // repo files, so excluding them removes the "whole project traced
  // unintentionally" over-trace without dropping any real runtime dependency.
  outputFileTracingExcludes: {
    "/api/leave/\\[requestId\\]/evidence": TRACE_NOISE,
    "/api/leave/\\[requestId\\]/evidence/\\[evidenceId\\]": TRACE_NOISE,
    "/api/leave": TRACE_NOISE,
    "/liff/evidence": TRACE_NOISE,
    "/liff/evidence/\\[requestId\\]": TRACE_NOISE,
  },

  // 1. อนุญาตให้ ngrok เข้าถึงระบบ
  allowedDevOrigins: [
    "hear-sponsored-colon-phoenix.trycloudflare.com"
  ],

  // Backwards-compatibility redirects so old Rich Menu / bookmarked URLs never
  // 404 — every destination is a real /liff/* route.
  async redirects() {
    return liffRedirects();
  },

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
