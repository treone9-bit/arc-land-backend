import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../../../lib/verifyAdminRequest";
import { mergeReiskipResults } from "../../../../../lib/leadGenerator";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const user = await requireAdmin(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const form = await req.formData();
    const mailingListFile = form.get("mailingList");
    const reiskipFile = form.get("reiskipResults");

    if (!(mailingListFile instanceof File) || !(reiskipFile instanceof File)) {
      return NextResponse.json({ error: "Missing file(s)" }, { status: 400 });
    }

    const mailingListBuffer = Buffer.from(await mailingListFile.arrayBuffer());
    const reiskipBuffer = Buffer.from(await reiskipFile.arrayBuffer());

    let result;
    try {
      result = mergeReiskipResults(mailingListBuffer, reiskipBuffer);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed to merge the files" },
        { status: 400 }
      );
    }

    const filename = `mailing-list-with-contacts-${Date.now()}.xlsx`;

    return new NextResponse(new Uint8Array(result.buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Matched-Count": String(result.matchedCount),
        "X-Total-Count": String(result.totalCount),
      },
    });
  } catch (err) {
    console.error("Lead generator merge error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
