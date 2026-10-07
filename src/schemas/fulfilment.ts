import { z } from "zod";

import { AreaChargeType } from "@/generated/prisma/enums";
import { formatNaira, parseNairaToKobo } from "@/lib/money";
import { areValidActiveDays, getClockTimeProblem, getHoursProblem, type HoursProblem } from "@/lib/pickup-schedule";
import { parseDateKey } from "@/lib/time";

export const MAX_AREA_CHARGE = 100_000_000; // ₦1,000,000 in kobo
export const AREA_NAME_MAX = 60;
export const CLOSED_DATE_NOTE_MAX = 100;

export const FULFILMENT_OPTIONS = ["dropOffEnabled", "pickupDeliveryEnabled"] as const;
export type FulfilmentOption = (typeof FULFILMENT_OPTIONS)[number];

export const FULFILMENT_OPTION_LABELS: Record<FulfilmentOption, string> = {
  dropOffEnabled: "Drop-off & collection",
  pickupDeliveryEnabled: "Pickup & delivery",
};

export const fulfilmentOptionSchema = z.enum(FULFILMENT_OPTIONS);

export const AREA_CHARGE_TYPE_LABELS: Record<AreaChargeType, string> = {
  FIXED: "Fixed charge",
  QUOTE_REQUIRED: "Quote required",
};

const CHARGE_FORMAT_MESSAGE = "Enter a charge in Naira, like 1,500, or 0 for free";

// The add/edit area form, as sent. A fixed charge is required for Fixed (₦0
// shows as "Free") and must be left empty for Quote required.
export const serviceAreaFormSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Area name must be at least 2 characters")
      .max(AREA_NAME_MAX, `Area name must be ${AREA_NAME_MAX} characters or fewer`),
    chargeType: z.enum(AreaChargeType, "Choose how this area is charged"),
    fixedCharge: z.string().max(40, CHARGE_FORMAT_MESSAGE).transform((value) => value.trim()),
  })
  .transform((area, ctx) => {
    if (area.chargeType === AreaChargeType.QUOTE_REQUIRED) {
      if (area.fixedCharge !== "") {
        ctx.addIssue({ code: "custom", path: ["fixedCharge"], message: "Leave the charge empty when a quote is required" });
        return z.NEVER;
      }
      return { name: area.name, chargeType: area.chargeType, fixedCharge: null };
    }

    if (area.fixedCharge === "") {
      ctx.addIssue({ code: "custom", path: ["fixedCharge"], message: "Enter the charge, or 0 for free" });
      return z.NEVER;
    }
    const kobo = parseNairaToKobo(area.fixedCharge);
    if (kobo === null) {
      ctx.addIssue({ code: "custom", path: ["fixedCharge"], message: CHARGE_FORMAT_MESSAGE });
      return z.NEVER;
    }
    if (kobo > MAX_AREA_CHARGE) {
      ctx.addIssue({
        code: "custom",
        path: ["fixedCharge"],
        message: `Charge must be ${formatNaira(MAX_AREA_CHARGE)} or less`,
      });
      return z.NEVER;
    }
    return { name: area.name, chargeType: area.chargeType, fixedCharge: kobo };
  });

export type ServiceAreaInput = z.output<typeof serviceAreaFormSchema>;

// An ID from the client (service area or closed date). It is only ever looked
// up within the caller's own store.
export const recordIdSchema = z.string().trim().min(1).max(64);

export const HOURS_MESSAGES: Record<HoursProblem, string> = {
  INVALID_TIME: "Enter times as HH:MM, like 08:00",
  OFF_STEP: "Use 15-minute steps, like 08:00, 08:15 or 08:30",
  CLOSE_NOT_AFTER_OPEN: "Closing time must be after opening time",
};

// The schedule form: active days (each a checkbox value "0"–"6") and hours.
// With pickup & delivery on, at least one day and both times are required;
// with it off, the owner may save a partial schedule, but anything entered
// must still be valid.
export function scheduleFormSchema(pickupDeliveryEnabled: boolean) {
  return z
    .object({
      activeDays: z
        .array(z.string().regex(/^[0-6]$/, "Choose days from the list"))
        .max(7)
        .transform((days) => days.map(Number))
        .refine(areValidActiveDays, "Choose each day only once")
        .transform((days) => [...days].sort((a, b) => a - b)),
      openTime: z.string().trim().max(5, HOURS_MESSAGES.INVALID_TIME),
      closeTime: z.string().trim().max(5, HOURS_MESSAGES.INVALID_TIME),
    })
    .superRefine((schedule, ctx) => {
      if (pickupDeliveryEnabled && schedule.activeDays.length === 0) {
        ctx.addIssue({ code: "custom", path: ["activeDays"], message: "Choose at least one day for pickup & delivery" });
      }
      const { openTime, closeTime } = schedule;
      if (!openTime && !closeTime) {
        if (pickupDeliveryEnabled) {
          ctx.addIssue({ code: "custom", path: ["openTime"], message: "Enter the opening time" });
          ctx.addIssue({ code: "custom", path: ["closeTime"], message: "Enter the closing time" });
        }
        return;
      }
      if (!openTime || !closeTime) {
        const path = openTime ? "closeTime" : "openTime";
        ctx.addIssue({ code: "custom", path: [path], message: "Enter both opening and closing times" });
        return;
      }
      // Each time's own problem (format or step) goes on that field; only then
      // is the pair compared, and that error goes on the closing time.
      const fieldProblems = (["openTime", "closeTime"] as const).flatMap((field) => {
        const problem = getClockTimeProblem(schedule[field]);
        return problem ? [{ field, problem }] : [];
      });
      for (const { field, problem } of fieldProblems) {
        ctx.addIssue({ code: "custom", path: [field], message: HOURS_MESSAGES[problem] });
      }
      if (fieldProblems.length === 0 && getHoursProblem(openTime, closeTime) === "CLOSE_NOT_AFTER_OPEN") {
        ctx.addIssue({ code: "custom", path: ["closeTime"], message: HOURS_MESSAGES.CLOSE_NOT_AFTER_OPEN });
      }
    })
    .transform((schedule) => ({
      activeDays: schedule.activeDays,
      openTime: schedule.openTime || null,
      closeTime: schedule.closeTime || null,
    }));
}

export type ScheduleInput = z.output<ReturnType<typeof scheduleFormSchema>>;

// A closed date: today or later in the store's time zone (`today` is that
// date as "YYYY-MM-DD"), with an optional note.
export function closedDateFormSchema(today: string) {
  return z.object({
    date: z
      .string()
      .trim()
      .transform((value, ctx) => {
        const key = parseDateKey(value);
        if (key === null) {
          ctx.addIssue({ code: "custom", message: "Choose a date" });
          return z.NEVER;
        }
        return key;
      })
      .refine((key) => key >= today, "Choose today or a later date"),
    // Blank (or only spaces) is saved as no note.
    note: z
      .string()
      .trim()
      .max(CLOSED_DATE_NOTE_MAX, `Note must be ${CLOSED_DATE_NOTE_MAX} characters or fewer`)
      .transform((value) => value || null),
  });
}

export type ClosedDateInput = z.output<ReturnType<typeof closedDateFormSchema>>;
