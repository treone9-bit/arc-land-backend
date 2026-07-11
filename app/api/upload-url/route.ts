import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { adminStorage } from "../../../lib/firebaseAdmin";

// Vercel caps serverless function request bodies at 4.5MB (hard platform limit,
// not configurable). A base64-encoded 4MB plan file already exceeds that on its
// own, so uploads go straight from the browser to Storage instead of through
// our API — this endpoint only hands out a short-lived signed PUT URL.
const AllowedType = z.enum(["application/pdf", "image/png", "image/jpeg", "image/webp"]);

const RequestSchema = z.object({
  filename: z.string().min(1).max(200),
  contentType: AllowedType,
});

export async function POST(req: NextRequest) {
  try {
    if (!process.env.FIREBASE_PROJECT_ID) {
      return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
    }

    const body = await req.json();
    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const { filename, contentType } = parsed.data;
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
    const path = `pending-uploads/${randomUUID()}/${safeName}`;

    const [url] = await adminStorage()
      .bucket()
      .file(path)
      .getSignedUrl({
        action: "write",
        expires: Date.now() + 15 * 60 * 1000, // 15 minutes
        contentType,
      });

    return NextResponse.json({ url, path });
  } catch (err) {
    console.error("Upload URL generation error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
