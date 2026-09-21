import path from "node:path";
import type { NextConfig } from "next";

/**
 * Куда проксировать /api/*. Читается при сборке: rewrites попадают в манифест маршрутов,
 * поэтому смена адреса API = пересборка веба.
 */
const apiUrl = (process.env.WINVINO_API_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");

/** Корень npm-workspace (platform/): оттуда резолвятся @winvino/contract и общие node_modules. */
const workspaceRoot = path.join(__dirname, "..");

/**
 * web.telegram.org показывает мини-аппы в iframe, поэтому X-Frame-Options: DENY из гайда
 * по PWA здесь нельзя — вместо него явный список, кому разрешено нас встраивать.
 */
const FRAME_ANCESTORS = "frame-ancestors 'self' https://web.telegram.org";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Docker-образ (deploy/web.Dockerfile) собирается как standalone; локально и в e2e — `next start`.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  transpilePackages: ["@winvino/contract"],
  turbopack: { root: workspaceRoot },
  outputFileTracingRoot: workspaceRoot,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiUrl}/:path*` }];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Content-Security-Policy", value: FRAME_ANCESTORS },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
