import { NextRequest, NextResponse } from "next/server";
import { generateQuote, QuoteGenerationError } from "../../../../lib/quoteGeneration";
import { requireAdmin } from "../../../../lib/verifyAdminRequest";

// Same as /api/checkout/complete — runs the full Claude generation, needs
// more than Vercel's default 10s serverless timeout. 300s is the max on
// Vercel Pro; complex multi-trade takeoffs with extended thinking can take
// 30-90+ seconds, so this gives comfortable headroom.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const user = await requireAdmin(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { quote, estimateId } = await generateQuote(body, { source: "admin_free" });
    return NextResponse.json({ quote, estimateId });
  } catch (err) {
    const status = err instanceof QuoteGenerationError ? err.status : 500;
    const message = err instanceof QuoteGenerationError ? err.message : "Internal error";
    if (!(err instanceof QuoteGenerationError)) console.error("Admin quote generation error:", err);
    return NextResponse.json({ error: message }, { status });
  }
}
