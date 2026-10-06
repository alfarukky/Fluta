import { z } from "zod";

// Store brand colours are strictly #RRGGBB. Kept apart from the settings form
// schemas (store-settings.ts) so client code can use it without pulling in
// phone-number metadata.
export const brandColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Enter a colour as #RRGGBB");
