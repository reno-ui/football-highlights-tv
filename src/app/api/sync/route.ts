import { NextResponse } from "next/server";
import { syncRedditHighlights } from "../../../lib/sync";

export async function GET() {
  try {
    const result = await syncRedditHighlights();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
