import "server-only";

import type { OrderStage, StoreStatus } from "@/generated/prisma/enums";
import { addDaysToDateKey, getLocalDateKey, getMinutesInTimeZone, startOfLocalDay } from "@/lib/time";

// The rules for customer reviews and their one reminder email (Feature 19b).
// Pure: no database, network, or clock.

const HOUR_MS = 60 * 60 * 1000;

// ───────────── The review window ─────────────

// A review can be left until exactly 7 × 24 hours after the order was
// completed (completed 29 Oct at 3:00 PM: open until 5 Nov at 3:00 PM).
export const REVIEW_WINDOW_MS = 7 * 24 * HOUR_MS;

export interface ReviewableOrder {
  stage: OrderStage;
  completedAt: Date | null;
}

// When the review window ends, or null for an order that isn't completed.
export function getReviewWindowEnd(order: ReviewableOrder): Date | null {
  if (order.stage !== "COMPLETED" || order.completedAt === null) return null;
  return new Date(order.completedAt.getTime() + REVIEW_WINDOW_MS);
}

// Only while the order is Completed (never Cancelled, never reopened), and
// within 7 days of its latest completion. Reopening clears completedAt, so
// completing again starts a new window.
export function isWithinReviewWindow(order: ReviewableOrder, now: Date): boolean {
  const end = getReviewWindowEnd(order);
  return end !== null && now.getTime() < end.getTime();
}

export type ReviewRefusal = "NOT_COMPLETED" | "WINDOW_ENDED" | "ALREADY_REVIEWED";

// Why this order can't be reviewed now, or null when it can. A review that
// exists is final, whatever happened to the order since.
export function getReviewRefusal(order: ReviewableOrder & { hasReview: boolean }, now: Date): ReviewRefusal | null {
  if (order.hasReview) return "ALREADY_REVIEWED";
  if (order.stage !== "COMPLETED" || order.completedAt === null) return "NOT_COMPLETED";
  return isWithinReviewWindow(order, now) ? null : "WINDOW_ENDED";
}

// ───────────── The reminder email ─────────────

// About 3 hours after completion, so the customer has time to unpack.
export const REVIEW_REMINDER_DELAY_MS = 3 * HOUR_MS;

// Daytime in the store's time zone: from 8:00 AM up to (not including) 8:00 PM.
export const REMINDER_DAY_START_MINUTES = 8 * 60;
export const REMINDER_DAY_END_MINUTES = 20 * 60;

export function isReminderDaytime(at: Date, timeZone: string): boolean {
  const minutes = getMinutesInTimeZone(at, timeZone);
  return minutes >= REMINDER_DAY_START_MINUTES && minutes < REMINDER_DAY_END_MINUTES;
}

// 8:00 AM on a store-local calendar day.
function morningOf(dateKey: string, timeZone: string): Date {
  return new Date(startOfLocalDay(dateKey, timeZone).getTime() + REMINDER_DAY_START_MINUTES * 60 * 1000);
}

// When the reminder becomes due: 3 hours after completion, or, if that falls
// at night in the store's time zone, the next 8:00 AM there.
export function getReviewReminderDueAt(completedAt: Date, timeZone: string): Date {
  const due = new Date(completedAt.getTime() + REVIEW_REMINDER_DELAY_MS);
  if (isReminderDaytime(due, timeZone)) return due;
  const day = getLocalDateKey(due, timeZone);
  const minutes = getMinutesInTimeZone(due, timeZone);
  return morningOf(minutes < REMINDER_DAY_START_MINUTES ? day : addDaysToDateKey(day, 1), timeZone);
}

export interface ReminderOrder extends ReviewableOrder {
  storeStatus: StoreStatus;
  timeZone: string;
  hasReview: boolean;
}

// Whether the scheduled job queues the reminder now: the order is still
// completed and unreviewed, it is due, it is daytime in the store's time zone
// (a reminder that came due at night waits for the morning), and the review
// window is still open. Whether one was already queued, the customer has an
// email, and email copies are on are decided with the database.
export function isReviewReminderDue(order: ReminderOrder, now: Date): boolean {
  if (order.storeStatus === "DEACTIVATED" || order.completedAt === null) return false;
  if (getReviewRefusal(order, now) !== null) return false;
  return now.getTime() >= getReviewReminderDueAt(order.completedAt, order.timeZone).getTime() && isReminderDaytime(now, order.timeZone);
}

// The last check just before each attempt to send it: a reminder queued
// earlier and retried later isn't sent once the customer has reviewed, the
// order was reopened or cancelled, the window has ended, or the store was
// deactivated (its link no longer opens anything).
export function isReviewReminderStillNeeded(order: Omit<ReminderOrder, "timeZone">, now: Date): boolean {
  return order.storeStatus !== "DEACTIVATED" && getReviewRefusal(order, now) === null;
}
