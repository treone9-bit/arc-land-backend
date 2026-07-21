/** @type {import('next').NextConfig} */
const nextConfig = {
  // firebase-admin pulls in jwks-rsa -> jose, an ESM-only package that crashes
  // with ERR_REQUIRE_ESM when webpack bundles it into a serverless function.
  // Keeping firebase-admin external makes Node load it natively at runtime instead.
  // pdfjs-dist has the same class of problem: its Node "fake worker" fallback
  // resolves pdf.worker.mjs via a path that doesn't survive webpack bundling
  // (moved into .next/server/chunks/, breaking the relative lookup). Keeping
  // it external lets Node load the package's real, unmodified file layout.
  // (serverExternalPackages is the stable Next.js 15+ key; on 14.2.x it's still
  // under experimental.)
  experimental: {
    serverComponentsExternalPackages: ["firebase-admin", "pdfjs-dist"],
  },
};

export default nextConfig;
