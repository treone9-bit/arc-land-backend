import { NextRequest, NextResponse } from "next/server";
import { stripeClient } from "../../../../lib/stripe";
import { generateQuote, QuoteGenerationError, type QuoteResult, type EstMeta } from "../../../../lib/quoteGeneration";
import { adminDb, adminStorage } from "../../../../lib/firebaseAdmin";

// This route runs the full Claude generation (30-90+ seconds for complex jobs,
// per the measured per-request cost breakdown) — Vercel's default 10s serverless
// timeout would kill it almost every time. 60s is the max allowed on the Hobby
// plan; upgrade to Pro (300s max) if the most complex plan takeoffs still time out.
export const maxDuration = 60;

type Bbox = { minLng: number; maxLng: number; minLat: number; maxLat: number };

type RequestSummary = {
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  address: string | null;
  county: string | null;
  state: string | null;
  parcelId: string | null;
  mapBbox: Bbox | null;
  parcelRings: number[][][] | null;
};

function summarize(data: Record<string, unknown>): RequestSummary {
  return {
    contactName: (data.contactName as string) ?? null,
    contactPhone: (data.contactPhone as string) ?? null,
    contactEmail: (data.contactEmail as string) ?? null,
    address: (data.address as string) ?? null,
    county: (data.county as string) ?? null,
    state: (data.state as string) ?? null,
    parcelId: (data.parcelId as string) ?? null,
    mapBbox: (data.mapBbox as Bbox) ?? null,
    parcelRings: (data.parcelRings as number[][][]) ?? null,
  };
}

// Firestore rejects arrays nested directly inside arrays, so parcelRings
// (number[][][]) has to round-trip as a JSON string in storage.
function toFirestoreRequest(request: RequestSummary): Record<string, unknown> {
  return { ...request, parcelRings: request.parcelRings ? JSON.stringify(request.parcelRings) : null };
}

function fromFirestoreRequest(stored: Record<string, unknown>): RequestSummary {
  const parcelRingsRaw = stored.parcelRings;
  return {
    ...(stored as unknown as RequestSummary),
    parcelRings: typeof parcelRingsRaw === "string" ? JSON.parse(parcelRingsRaw) : null,
  };
}

export async function GET(req: NextRequest) {
  try {
    const sessionId = req.nextUrl.searchParams.get("session_id");
    const pendingId = req.nextUrl.searchParams.get("pending_id");
    if (!sessionId || !pendingId) {
      return NextResponse.json({ error: "Missing session_id or pending_id" }, { status: 400 });
    }

    // Idempotent replay — page refresh after a successful completion shouldn't
    // re-bill Anthropic or create a duplicate estimate record.
    const consumedRef = adminDb().collection("consumedCheckoutSessions").doc(sessionId);
    const consumedSnap = await consumedRef.get();
    if (consumedSnap.exists) {
      const data = consumedSnap.data()!;
      return NextResponse.json({
        quote: data.quote,
        estMeta: data.estMeta,
        request: fromFirestoreRequest(data.request),
      });
    }

    const stripe = stripeClient();
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== "paid") {
      return NextResponse.json({ error: "Payment not completed" }, { status: 402 });
    }
    if (session.metadata?.pendingId !== pendingId) {
      return NextResponse.json({ error: "Session/pending id mismatch" }, { status: 400 });
    }

    const bucket = adminStorage().bucket();
    const pendingFile = bucket.file(`pending-quotes/${pendingId}.json`);
    const [exists] = await pendingFile.exists();
    if (!exists) {
      return NextResponse.json({ error: "Pending quote request not found or already used" }, { status: 404 });
    }
    const [contents] = await pendingFile.download();
    const requestData = JSON.parse(contents.toString("utf8")) as Record<string, unknown>;

    let quote: QuoteResult;
    let estMeta: EstMeta;
    try {
      ({ quote, estMeta } = await generateQuote(requestData, { source: "customer" }));
    } catch (err) {
      const status = err instanceof QuoteGenerationError ? err.status : 500;
      const message = err instanceof QuoteGenerationError ? err.message : "Internal error";
      return NextResponse.json({ error: message }, { status });
    }

    const request = summarize(requestData);

    await consumedRef.set({
      consumedAt: new Date(),
      pendingId,
      quote,
      estMeta,
      request: toFirestoreRequest(request),
    });

    pendingFile.delete().catch((err) => console.error("Failed to clean up pending quote blob:", err));

    return NextResponse.json({ quote, estMeta, request });
  } catch (err) {
    console.error("Checkout completion error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
