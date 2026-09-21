import type { MetadataRoute } from "next";
import { APP_DESCRIPTION, APP_NAME, APP_TITLE, BRAND_COLORS } from "./brand";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: APP_TITLE,
    short_name: APP_NAME,
    description: APP_DESCRIPTION,
    lang: "ru",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: BRAND_COLORS.paper,
    theme_color: BRAND_COLORS.paper,
    categories: ["food", "lifestyle"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
