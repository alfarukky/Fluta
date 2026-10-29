import { z } from "zod";

import { parseClockTime } from "@/lib/pickup-schedule";
import { parseDateKey } from "@/lib/time";

import { INTERNAL_NOTE_MAX, orderIdSchema } from "./orders";

// Staff confirming a pickup order's requested time, or suggesting another.

export const SUGGESTION_NOTE_MAX = INTERNAL_NOTE_MAX;

const clockTime = z.string().refine((value) => parseClockTime(value) !== null, "Choose a pickup window");

export const confirmPickupSchema = z.object({ orderId: orderIdSchema });

export const suggestPickupSchema = z
  .object({
    orderId: orderIdSchema,
    date: z.string().refine((value) => parseDateKey(value) !== null, "Choose a pickup date"),
    outsideSchedule: z.boolean(),
    windowStart: clockTime,
    windowEnd: clockTime,
    // Required outside the normal schedule (staff only, never shown to customers).
    note: z
      .string()
      .trim()
      .max(SUGGESTION_NOTE_MAX, `Note must be ${SUGGESTION_NOTE_MAX} characters or fewer`)
      .nullish()
      .transform((value) => value || null),
  })
  .superRefine((input, ctx) => {
    if (input.outsideSchedule && !input.note) {
      ctx.addIssue({ code: "custom", path: ["note"], message: "Add a note explaining the pickup outside the normal schedule" });
    }
  });

export type SuggestPickupInput = z.output<typeof suggestPickupSchema>;
