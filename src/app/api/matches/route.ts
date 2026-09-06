import { NextResponse } from "next/server";
import { prisma } from "../../../lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const matches = await prisma.matchPost.findMany({
      orderBy: { publishedAt: "desc" },
      include: {
        links: true,
      },
      take: 60,
    });

    return NextResponse.json({ matches });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
