import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "../../../../lib/firebaseAdmin";
import { requireAdmin } from "../../../../lib/verifyAdminRequest";

export async function GET(req: NextRequest) {
  const user = await requireAdmin(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const snapshot = await adminDb()
    .collection("estimates")
    .orderBy("createdAt", "desc")
    .limit(200)
    .get();

  const estimates = snapshot.docs.map((doc) => {
    const data = doc.data();
    const quote = data.quote as { total?: number } | undefined;
    return {
      id: doc.id,
      createdAt: data.createdAt?.toDate?.().toISOString() ?? null,
      serviceType: data.serviceType ?? null,
      address: data.address ?? null,
      county: data.county ?? null,
      state: data.state ?? null,
      contactName: data.contactName ?? null,
      contactPhone: data.contactPhone ?? null,
      contactEmail: data.contactEmail ?? null,
      total: quote?.total ?? null,
      fromCache: data.fromCache ?? false,
      source: data.source ?? "customer",
    };
  });

  return NextResponse.json({ estimates });
}
