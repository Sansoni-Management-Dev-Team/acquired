/** Native fallback when client-side authentication has not hydrated.
 * Never read, authenticate, log or reflect the submitted credential body. */
export function POST() {
  return new Response("The form did not load. Return to the previous page, reload it, and enable JavaScript before trying again.", {
    status: 400,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
