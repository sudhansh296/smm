/** @type {import('next').NextConfig} */
const nextConfig = {
  // Required for the Docker web image (apps/web/Dockerfile copies .next/standalone).
  // Known tradeoff: `next build` (not `next dev`) hits an EPERM symlink error on
  // Windows with this enabled -- doesn't affect local dev, only a local Windows build.
  output: "standalone",
  experimental: {
    serverComponentsExternalPackages: [],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
