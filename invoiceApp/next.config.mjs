/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ["@curvegrid/multibaas-sdk"],
  },
};

export default nextConfig;
