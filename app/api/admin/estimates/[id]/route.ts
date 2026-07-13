import { NextRequest, NextResponse } from "next/server";
import { adminDb, adminStorage } from "../../../../../lib/firebaseAdmin";
import { requireAdmin } from "../../../../../lib/verifyAdminRequest";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireAdmin(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const doc = await adminDb().collection("estimates").doc(params.id).get();
  if (!doc.exists) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const data = doc.data()!;
  const planFilePaths: string[] = data.planFilePaths ?? [];

  const bucket = adminStorage().bucket();
  const planFileUrls = await Promise.all(
    planFilePaths.map(async (path) => {
      const [url] = await bucket.file(path).getSignedUrl({
        action: "read",
        expires: Date.now() + 15 * 60 * 1000, // 15 minutes
      });
      return { path, url };
    })
  );

  return NextResponse.json({
    id: doc.id,
    createdAt: data.createdAt?.toDate?.().toISOString() ?? null,
    serviceType: data.serviceType ?? null,
    address: data.address ?? null,
    county: data.county ?? null,
    state: data.state ?? null,
    zipCode: data.zipCode ?? null,
    parcelId: data.parcelId ?? null,
    ownerName: data.ownerName ?? null,
    zoning: data.zoning ?? null,
    acreage: data.acreage ?? null,
    contactName: data.contactName ?? null,
    contactPhone: data.contactPhone ?? null,
    contactEmail: data.contactEmail ?? null,
    additionalNotes: data.additionalNotes ?? null,
    trades: data.trades ?? null,
    serviceTypes: data.serviceTypes ?? null,
    fromCache: data.fromCache ?? false,
    quote: data.quote ?? null,
    planFileUrls,
    source: data.source ?? "customer",
    estNum: data.estNum ?? null,
    estDate: data.estDate ?? null,
    mapBbox: data.mapBbox ?? null,
    parcelRings: typeof data.parcelRings === "string" ? JSON.parse(data.parcelRings) : null,
  });
}
