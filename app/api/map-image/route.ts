import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  let minLng: number, minLat: number, maxLng: number, maxLat: number;

  if (searchParams.has("minLng")) {
    minLng = Number(searchParams.get("minLng"));
    minLat = Number(searchParams.get("minLat"));
    maxLng = Number(searchParams.get("maxLng"));
    maxLat = Number(searchParams.get("maxLat"));
    if ([minLng, minLat, maxLng, maxLat].some(isNaN)) {
      return new NextResponse("Invalid bbox params", { status: 400 });
    }
  } else {
    const lat = Number(searchParams.get("lat"));
    const lng = Number(searchParams.get("lng"));
    if (isNaN(lat) || isNaN(lng)) {
      return new NextResponse("Missing or invalid lat/lng", { status: 400 });
    }
    minLng = lng - 0.0024;
    maxLng = lng + 0.0024;
    minLat = lat - 0.0018;
    maxLat = lat + 0.0018;
  }

  const url = new URL(
    "https://server.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/export"
  );
  url.searchParams.set("bbox", `${minLng},${minLat},${maxLng},${maxLat}`);
  url.searchParams.set("bboxSR", "4326");
  url.searchParams.set("size", "640,480");
  url.searchParams.set("format", "png");
  url.searchParams.set("transparent", "false");
  url.searchParams.set("f", "image");

  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    return new NextResponse("Map fetch failed", { status: 502 });
  }

  const buffer = await res.arrayBuffer();
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": res.headers.get("Content-Type") ?? "image/png",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
