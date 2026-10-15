import { storeSlugSchema } from "@/schemas/booking";
import { findBookableStore } from "@/server/services/booking";
import { renderPreviewImage } from "@/server/services/store-app";

// The booking link's preview image. A Deactivated store's link shows no store
// details, so it has none.
export async function GET(_request: Request, ctx: RouteContext<"/store/[slug]/preview-image">): Promise<Response> {
  const slug = storeSlugSchema.safeParse((await ctx.params).slug);
  const bookable = slug.success ? await findBookableStore(slug.data) : null;
  if (!bookable) return new Response("Not found", { status: 404 });
  return renderPreviewImage(bookable);
}
