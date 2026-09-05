/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Phase one has no service worker and no image optimization dependency in T0.
  poweredByHeader: false,
};

export default nextConfig;
