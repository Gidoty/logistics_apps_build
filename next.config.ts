import type { NextConfig } from "next";

// Product photos come from Supabase Storage (public bucket) and are resized by
// next/image. Only that bucket's path on our own project is allowed.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const remotePatterns: NonNullable<NextConfig["images"]>["remotePatterns"] = [];
if (supabaseUrl) {
  const url = new URL(supabaseUrl);
  remotePatterns.push({
    protocol: url.protocol === "https:" ? "https" : "http",
    hostname: url.hostname,
    port: url.port,
    pathname: "/storage/v1/object/public/product-images/**",
  });
}

const nextConfig: NextConfig = {
  images: {
    remotePatterns,
    // Phones are the main screens, so skip the very large sizes.
    deviceSizes: [360, 480, 640, 828, 1080],
    // Local Supabase runs on 127.0.0.1, which the optimizer refuses by default.
    // Allowed in development only.
    dangerouslyAllowLocalIP: process.env.NODE_ENV !== "production",
  },
  // The tracking link is a secret in the URL: keep it out of caches, search
  // engines and the Referer header of any link followed from the page.
  async headers() {
    return [
      {
        source: "/t/:token*",
        headers: [
          { key: "Cache-Control", value: "no-store" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};

export default nextConfig;
