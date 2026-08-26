import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Twilio Voice softphone registers one WebRTC endpoint per rep identity.
  // React Strict Mode double-invokes effects in dev, which would register a
  // second endpoint with the same identity and get kicked (ConnectionError
  // 53000). Disable the double-invoke so the softphone connects cleanly.
  reactStrictMode: false,
  output: "standalone",
};

export default nextConfig;
