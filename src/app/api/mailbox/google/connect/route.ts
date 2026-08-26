import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createGoogleAuthorization } from "@/lib/google-oauth";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.redirect(new URL("/sign-in?next=/settings", request.url));
  const organizationId = session.session.activeOrganizationId;
  if (!organizationId) return NextResponse.json({ error: "Select an organisation before connecting Gmail" }, { status: 400 });
  const { url } = createGoogleAuthorization({ userId: session.user.id, organizationId, loginHint: session.user.email });
  return NextResponse.redirect(url);
}
