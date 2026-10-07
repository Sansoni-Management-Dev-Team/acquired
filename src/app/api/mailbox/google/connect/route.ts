import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createGoogleAuthorization } from "@/lib/google-oauth";
import { appRedirectUrl } from "@/lib/request-origin";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.redirect(appRedirectUrl("/sign-in?next=/settings", request));
  const organizationId = session.session.activeOrganizationId;
  if (!organizationId) return NextResponse.redirect(appRedirectUrl("/onboarding", request));
  const { url } = createGoogleAuthorization({ userId: session.user.id, organizationId, loginHint: session.user.email });
  return NextResponse.redirect(url);
}
