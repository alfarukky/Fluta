// Railway's health check: 200 with no body once the server is up, so a
// deploy only goes live when the new version starts. It reads nothing and
// needs no secrets, so it never says anything about the app or its data.
export function GET(): Response {
  return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
}
