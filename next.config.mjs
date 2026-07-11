/** @type {import('next').NextConfig} */
const nextConfig = {
  // firebase-admin pulls in jwks-rsa -> jose, an ESM-only package that crashes
  // with ERR_REQUIRE_ESM when webpack bundles it into a serverless function.
  // Keeping firebase-admin external makes Node load it natively at runtime instead.
  // (serverExternalPackages is the stable Next.js 15+ key; on 14.2.x it's still
  // under experimental.)
  experimental: {
    serverComponentsExternalPackages: ["firebase-admin"],
  },
};

export default nextConfig;
