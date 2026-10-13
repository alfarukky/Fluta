"use client";

import { useEffect, useRef, useState } from "react";

// Forms with errors scroll to the problem (coding standards, React). Every
// form with three or more fields, or that scrolls, uses this one helper:
// after a submit with errors (from the browser's own checks or the server),
// it scrolls to the first invalid field in page order and focuses it, which
// on phones also opens the keyboard.
//
// - Invalid fields are found by aria-invalid="true", which every field with
//   an error already sets, linked to its message with aria-describedby.
// - The scroll target is the field's wrapper (data-form-field on FormField),
//   so its label stays in view. Its scroll-margin-top keeps it clear of the
//   sticky top bar, or a little below the top inside a drawer or dialog
//   (globals.css). scrollIntoView scrolls whichever container holds the
//   form: the page, or the drawer.
// - With reduced motion turned on, the scroll is an instant jump.

const FOCUSABLE = [
  "input:not([disabled]):not([type='hidden'])",
  "textarea:not([disabled])",
  "select:not([disabled])",
  "button:not([disabled]):not([tabindex='-1'])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

export function prefersReducedMotion(view: Window = window): boolean {
  return view.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

// Scrolls to and focuses the first invalid field inside `container`, and
// returns the element focused (null when nothing is invalid).
export function focusFirstInvalidField(container: HTMLElement): HTMLElement | null {
  const invalid = container.querySelector<HTMLElement>("[aria-invalid='true']");
  if (!invalid) return null;
  // A group (radio group, day checkboxes) is marked as a whole: focus the
  // control inside it that takes focus.
  const field = invalid.matches(FOCUSABLE) ? invalid : (invalid.querySelector<HTMLElement>(FOCUSABLE) ?? invalid);
  const target = invalid.closest<HTMLElement>("[data-form-field]") ?? invalid;

  const view = container.ownerDocument.defaultView ?? window;
  target.scrollIntoView({ block: "start", behavior: prefersReducedMotion(view) ? "instant" : "smooth" });
  // The scroll above already brought it into view.
  field.focus({ preventScroll: true });
  return field;
}

// Attach `ref` to the form (or the element around its fields), and call
// `scrollToFirstError()` whenever a submit finds errors, after setting them.
// The scroll waits for the render that marks the fields invalid.
export function useScrollToFirstError<T extends HTMLElement = HTMLFormElement>() {
  const ref = useRef<T>(null);
  const [request, setRequest] = useState(0);

  useEffect(() => {
    if (request > 0 && ref.current) focusFirstInvalidField(ref.current);
  }, [request]);

  return { ref, scrollToFirstError: () => setRequest((count) => count + 1) };
}
