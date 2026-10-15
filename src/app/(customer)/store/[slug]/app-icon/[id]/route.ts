import { storeSlugSchema } from "@/schemas/booking";
import { findBookableStore } from "@/server/services/booking";
import { isAppIconId, renderAppIcon } from "@/server/services/store-app";

// The store's home-screen icons (see APP_ICONS), from its own logo and colour.
export async function GET(_request: Request, ctx: RouteContext<"/store/[slug]/app-icon/[id]">): Promise<Response> {
  const params = await ctx.params;
  const slug = storeSlugSchema.safeParse(params.slug);
  const bookable = slug.success && isAppIconId(params.id) ? await findBookableStore(slug.data) : null;
  if (!bookable || !isAppIconId(params.id)) return new Response("Not found", { status: 404 });
  return renderAppIcon(bookable, params.id);
}
