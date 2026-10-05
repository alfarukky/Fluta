import { z } from "zod";

// Store brand colours are strictly #RRGGBB.
export const brandColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Enter a colour as #RRGGBB");
