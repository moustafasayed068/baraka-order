import type { MetadataRoute } from "next";

// Installable customer app ("Add to Home Screen"). Staff screens are plain pages, not part of it.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "البركة فرايد تشيكن — اطلب واستلم",
    short_name: "البركة",
    description: "اطلب من البركة واستلم من غير طابور، أو نوصّلك",
    lang: "ar",
    dir: "rtl",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#FFF7EC",
    theme_color: "#D9161C",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
