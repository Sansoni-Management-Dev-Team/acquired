import { authorizeChannelRequest, retiredChannelResponse } from "@/lib/retired-channel-route";
export async function GET(request: Request) {
    return await authorizeChannelRequest(request, true) ?? retiredChannelResponse();
}
