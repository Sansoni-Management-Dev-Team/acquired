import { auth } from "@/lib/auth";
import { appRedirectUrl, hasTrustedRequestOrigin } from "@/lib/request-origin";
/** Compatibility routes authorize the caller, but never load a channel credential or contact a provider. */
export async function authorizeChannelRequest(request: Request, redirectToSignIn = false): Promise<Response | null> {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
        if (redirectToSignIn)
            return Response.redirect(appRedirectUrl("/sign-in?next=/settings", request), 307);
        return Response.json({ error: "Sign in to manage connections" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    }
    if (!session.session.activeOrganizationId)
        return Response.json({ error: "Choose an organisation" }, { status: 403, headers: { "Cache-Control": "no-store" } });
    if (request.method !== "GET" && !hasTrustedRequestOrigin(request))
        return Response.json({ error: "Invalid origin" }, { status: 403, headers: { "Cache-Control": "no-store" } });
    return null;
}
export function retiredChannelResponse(): Response {
    return Response.json({ code: "connection_method_retired", error: "This connection method is no longer available. Use Unipile in Settings." }, { status: 410, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
export async function retiredChannelRoute(request: Request): Promise<Response> {
    return await authorizeChannelRequest(request) ?? retiredChannelResponse();
}
