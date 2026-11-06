import type { NextConfig } from "next";

const isVercelBuild = Boolean(process.env.VERCEL)
  || Boolean(process.env.VERCEL_ENV)
  || (process.platform !== "win32" && process.env.NODE_ENV === "production");

// Keep local output separate from dev and the OneDrive-locked earlier
// production cache. Vercel's Next.js adapter expects the standard .next folder.
// The dev script uses Webpack for reliable PDF chunks.
const nextConfig: NextConfig = {
  distDir: isVercelBuild
    ? ".next"
    : process.env.NODE_ENV === "production" ? ".next-prod-build-local" : ".next-dev-local",
};

export default nextConfig;
