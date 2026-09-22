import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/verifyAdminRequest";
import { parseUploadedWorkbook, lookupMailingAddresses, buildOutputWorkbook } from "../../../../lib/leadGenerator";

// Runs a batch of FDOR statewide-cadastral queries (chunked, limited
// concurrency) — can take a while for large lists, so give it the same
// headroom as the other long-running admin/generation routes.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const user = await requireAdmin(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const form = await req.formData();
    const file = form.get("file");
    const county = form.get("county");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }
    if (typeof county !== "string" || !county) {
      return NextResponse.json({ error: "Missing county" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    let rows, parcelColumnKey, ownerColumnKey;
    try {
      ({ rows, parcelColumnKey, ownerColumnKey } = parseUploadedWorkbook(buffer));
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed to parse the uploaded file" },
        { status: 400 }
      );
    }

    // Excel frequently stores a purely-numeric column (e.g. Parcel ID
    // "272901109") as a number rather than text, so accept both — filtering
    // on typeof === "string" alone silently drops every row in that case.
    const parcelNumbers = rows
      .map((r) => r[parcelColumnKey])
      .filter((v): v is string | number => (typeof v === "string" || typeof v === "number") && String(v).trim() !== "")
      .map((v) => String(v));

    const matches = await lookupMailingAddresses(parcelNumbers);

    let outputBuffer;
    try {
      outputBuffer = buildOutputWorkbook(rows, parcelColumnKey, matches, county, ownerColumnKey);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Nothing to export" },
        { status: 400 }
      );
    }

    const filename = `${county.replace(/\s+/g, "-")}-mailing-list-${Date.now()}.xlsx`;

    return new NextResponse(new Uint8Array(outputBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    console.error("Lead generator error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
