import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "../../../../../../lib/firebaseAdmin";
import { requireAdmin } from "../../../../../../lib/verifyAdminRequest";
import { reviseQuote, QuoteGenerationError } from "../../../../../../lib/quoteGeneration";

// Same as /api/admin/quote — runs a full Claude call, needs more than
// Vercel's default 10s serverless timeout.
export const maxDuration = 300;

const RequestSchema = z.object({
  instructions: z.string().min(1),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireAdmin(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = RequestSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Instructions are required" }, { status: 400 });
  }
  const { instructions } = parsed.data;

  const docRef = adminDb().collection("estimates").doc(params.id);
  const doc = await docRef.get();
  if (!doc.exists) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const data = doc.data()!;
  if (!data.quote) {
    return NextResponse.json({ error: "This estimate has no quote to revise" }, { status: 400 });
  }

  try {
    const revisedQuote = await reviseQuote({
      currentQuote: data.quote,
      instructions,
      serviceType: data.serviceType ?? "land_clearing",
      trades: data.trades ?? null,
      serviceTypes: data.serviceTypes ?? null,
      county: data.county ?? "",
      state: data.state ?? "",
      zipCode: data.zipCode ?? null,
    });

    await docRef.update({
      quote: revisedQuote,
      revisions: FieldValue.arrayUnion({ instructions, revisedAt: new Date() }),
    });

    return NextResponse.json({ quote: revisedQuote });
  } catch (err) {
    const status = err instanceof QuoteGenerationError ? err.status : 500;
    const message = err instanceof QuoteGenerationError ? err.message : "Internal error";
    if (!(err instanceof QuoteGenerationError)) console.error("Quote revision error:", err);
    return NextResponse.json({ error: message }, { status });
  }
}
