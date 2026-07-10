import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { adminDb } from "../../../lib/firebaseAdmin";

const FeedbackSchema = z.object({
  type: z.enum(["general", "estimate"]),
  message: z.string().trim().min(1).max(2000),
  email: z.string().trim().email().nullish(),
  rating: z.enum(["up", "down"]).nullish(),
  estimateNum: z.string().nullish(),
  pageUrl: z.string().nullish(),
});

export async function POST(req: NextRequest) {
  try {
    if (!process.env.FIREBASE_PROJECT_ID) {
      return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
    }

    const body = await req.json();
    const parsed = FeedbackSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: z.flattenError(parsed.error) },
        { status: 400 }
      );
    }

    const { type, message, email, rating, estimateNum, pageUrl } = parsed.data;

    await adminDb()
      .collection("feedback")
      .doc(randomUUID())
      .set({
        type,
        message,
        email: email ?? null,
        rating: rating ?? null,
        estimateNum: estimateNum ?? null,
        pageUrl: pageUrl ?? null,
        createdAt: new Date(),
      });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Feedback submission error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
