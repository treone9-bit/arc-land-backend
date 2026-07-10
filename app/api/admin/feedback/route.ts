import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "../../../../lib/firebaseAdmin";
import { requireAdmin } from "../../../../lib/verifyAdminRequest";

export async function GET(req: NextRequest) {
  const user = await requireAdmin(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const snapshot = await adminDb()
    .collection("feedback")
    .orderBy("createdAt", "desc")
    .limit(200)
    .get();

  const feedback = snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      createdAt: data.createdAt?.toDate?.().toISOString() ?? null,
      type: data.type ?? null,
      message: data.message ?? null,
      email: data.email ?? null,
      rating: data.rating ?? null,
      estimateNum: data.estimateNum ?? null,
      pageUrl: data.pageUrl ?? null,
    };
  });

  return NextResponse.json({ feedback });
}
