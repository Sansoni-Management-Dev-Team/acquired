import { getSessionCookie } from "better-auth/cookies";
import { NextRequest, NextResponse } from "next/server";
import { guardBrowserMutation } from "@/lib/browser-mutation";
import { appRedirectUrl } from "@/lib/request-origin";

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return guardBrowserMutation(request) ?? NextResponse.next();
  }
  if (getSessionCookie(request)) return NextResponse.next();

  const signIn = appRedirectUrl("/sign-in", request);
  signIn.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(signIn);
}

export const config = {
  matcher: ["/api/:path*", "/mandates/:path*", "/targets/:path*", "/outreach/:path*", "/audit/:path*", "/settings/:path*", "/onboarding/:path*", "/auth/complete/:path*"],
};
