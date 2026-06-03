import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "RVEP — Remote Vehicle Edge Control",
    short_name: "RVEP",
    description:
      "Remote Vehicle Edge Control & Vision Data Platform — Tesla-style cockpit for fleet teleoperation.",
    // P0-12: start at fleet page; unauthenticated users are redirected to /login
    // by the vehicles/page.tsx 401 handler.
    start_url: "/vehicles",
    scope: "/",
    display: "fullscreen",
    display_override: ["fullscreen", "standalone"],
    orientation: "landscape",
    background_color: "#050505",
    theme_color: "#050505",
    categories: ["productivity", "utilities"],
    lang: "zh-Hant",
    prefer_related_applications: false,
    // P0-11: PWA icons derived from the RVEP logo SVG in /public.
    // SVG is accepted by Chrome/Edge; Safari uses apple-touch-icon from <head>.
    icons: [
      {
        src: "/icon-192.svg",
        sizes: "192x192",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icon-512.svg",
        sizes: "512x512",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icon-512.svg",
        sizes: "512x512",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
