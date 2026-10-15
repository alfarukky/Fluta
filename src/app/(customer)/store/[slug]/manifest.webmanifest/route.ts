import { storeSlugSchema } from "@/schemas/booking";
import { findBookableStore } from "@/server/services/booking";
import { buildStoreManifest } from "@/server/services/store-app";

// The store's own home-screen app. An unknown or Deactivated store has none.
export async function GET(_request: Request, ctx: RouteContext<"/store/[slug]/manifest.webmanifest">): Promise<Response> {
  const slug = storeSlugSchema.safeParse((await ctx.params).slug);
  const bookable = slug.success ? await findBookableStore(slug.data) : null;
  if (!bookable) return new Response("Not found", { status: 404 });
  return Response.json(buildStoreManifest(bookable), {
    headers: { "Content-Type": "application/manifest+json", "Cache-Control": "no-cache" },
  });
}
