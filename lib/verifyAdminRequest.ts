import { NextRequest } from "next/server";
import { adminAuth } from "./firebaseAdmin";

export async function requireAdmin(req: NextRequest): Promise<{ uid: string } | null> {
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return null;
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    return { uid: decoded.uid };
  } catch {
    return null;
  }
}
