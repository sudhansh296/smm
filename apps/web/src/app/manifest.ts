import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "NexusSMM -- SMM Panel India",
    short_name: "NexusSMM",
    description: "Buy Telegram members, views, reactions and more. Pay in INR via UPI or USDT crypto.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#6366f1",
    icons: [
      {
        src: "/favicon.ico",
        sizes: "any",
        type: "image/x-icon",
      },
    ],
  };
}