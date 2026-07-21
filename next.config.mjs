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
    // Vercel's deploy step prunes each API route's bundle down to only files
    // reachable via static import analysis. pdfjs-dist loads its worker
    // script (and cmaps/font data) dynamically at runtime, so the tracer
    // can't see that dependency and prunes it away — works locally (full
    // node_modules always present) but 500s in production. Force-include
    // the whole package for every route that can reach generateQuote().
    outputFileTracingIncludes: {
      "/api/admin/quote": ["./node_modules/pdfjs-dist/**/*"],
      "/api/checkout/complete": ["./node_modules/pdfjs-dist/**/*"],
      "/api/admin/estimates/[id]/revise": ["./node_modules/pdfjs-dist/**/*"],
    },
  },
};

export default nextConfig;
