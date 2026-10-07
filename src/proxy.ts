import { getSessionCookie } from "better-auth/cookies";
import { NextRequest, NextResponse } from "next/server";
import { appRedirectUrl } from "@/lib/request-origin";

export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) return NextResponse.next();

  const signIn = appRedirectUrl("/sign-in", request);
  signIn.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(signIn);
}

export const config = {
  matcher: ["/mandates/:path*", "/targets/:path*", "/outreach/:path*", "/audit/:path*", "/settings/:path*", "/onboarding/:path*", "/auth/complete/:path*"],
};
