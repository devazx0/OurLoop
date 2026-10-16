import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    emailNotificationsEnabled: user.emailNotificationsEnabled,
  });
}

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { emailNotificationsEnabled } = body;

    if (typeof emailNotificationsEnabled !== "boolean") {
      return NextResponse.json(
        { error: "emailNotificationsEnabled must be a boolean" },
        { status: 400 }
      );
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { emailNotificationsEnabled },
      select: { emailNotificationsEnabled: true },
    });

    return NextResponse.json(updated);
  } catch (error: unknown) {
    console.error("Failed to update notification settings:", error);
    return NextResponse.json(
      { error: (error as Error)?.message || "Failed to update settings" },
      { status: 500 }
    );
  }
}
