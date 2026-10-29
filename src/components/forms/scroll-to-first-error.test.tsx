import { fireEvent, render, screen } from "@testing-library/react";
import { useState, type FormEvent } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { focusFirstInvalidField, useScrollToFirstError } from "./scroll-to-first-error";

// jsdom has neither scrollIntoView nor matchMedia: record what was asked.
const scrolled: { element: Element; options: ScrollIntoViewOptions | boolean | undefined }[] = [];
let reducedMotion = false;

beforeEach(() => {
  scrolled.length = 0;
  reducedMotion = false;
  Element.prototype.scrollIntoView = function (this: Element, options?: ScrollIntoViewOptions | boolean) {
    scrolled.push({ element: this, options });
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({ matches: query.includes("reduce") && reducedMotion, media: query })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

function container(html: string): HTMLElement {
  const element = document.createElement("form");
  element.innerHTML = html;
  document.body.append(element);
  return element;
}

describe("focusFirstInvalidField", () => {
  it("picks the first invalid field in page order and focuses it", () => {
    const form = container(`
      <div data-form-field id="name-wrapper"><label for="name">Name</label><input id="name" /></div>
      <div data-form-field id="phone-wrapper"><label for="phone">Phone</label><input id="phone" aria-invalid="true" /></div>
      <div data-form-field><label for="email">Email</label><input id="email" aria-invalid="true" /></div>
    `);

    const focused = focusFirstInvalidField(form);
    expect(focused?.id).toBe("phone");
    expect(document.activeElement?.id).toBe("phone");
    // The wrapper scrolls into view, so the label shows too.
    expect(scrolled).toEqual([{ element: document.getElementById("phone-wrapper"), options: { block: "start", behavior: "smooth" } }]);
  });

  it("jumps instantly when the user prefers reduced motion", () => {
    reducedMotion = true;
    const form = container(`<input id="name" aria-invalid="true" />`);
    focusFirstInvalidField(form);
    expect(scrolled[0].options).toEqual({ block: "start", behavior: "instant" });
  });

  it("focuses the control inside an invalid group", () => {
    const form = container(`
      <div data-form-field>
        <div role="radiogroup" aria-invalid="true">
          <button type="button" role="radio" tabindex="-1" id="first">Per item</button>
          <button type="button" role="radio" tabindex="0" id="checked">Per package</button>
        </div>
      </div>
    `);
    expect(focusFirstInvalidField(form)?.id).toBe("checked");
  });

  it("does nothing when no field is invalid", () => {
    const form = container(`<input id="name" aria-invalid="false" />`);
    expect(focusFirstInvalidField(form)).toBeNull();
    expect(scrolled).toEqual([]);
  });
});

// A form like the app's: errors come back, fields are marked, then the
// helper runs after that render.
function TestForm({ validate }: { validate: (values: { name: string; phone: string }) => Record<string, string> }) {
  const [values, setValues] = useState({ name: "", phone: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { ref, scrollToFirstError } = useScrollToFirstError();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = validate(values);
    setErrors(found);
    if (Object.keys(found).length > 0) scrollToFirstError();
  }

  return (
    <form ref={ref} onSubmit={submit} noValidate>
      {(["name", "phone"] as const).map((field) => (
        <div data-form-field key={field}>
          <label htmlFor={field}>{field}</label>
          <input
            id={field}
            value={values[field]}
            onChange={(event) => setValues((current) => ({ ...current, [field]: event.target.value }))}
            aria-invalid={errors[field] ? true : undefined}
            aria-describedby={errors[field] ? `${field}-error` : undefined}
          />
          {errors[field] && <p id={`${field}-error`}>{errors[field]}</p>}
        </div>
      ))}
      <button type="submit">Save</button>
    </form>
  );
}

describe("useScrollToFirstError", () => {
  it("focuses the first invalid field once the errors are shown, and marks every invalid field", () => {
    render(<TestForm validate={() => ({ name: "Enter a name", phone: "Enter the customer's phone number" })} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(document.activeElement).toBe(screen.getByLabelText("name"));
    expect(screen.getByLabelText("phone").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText("phone").getAttribute("aria-describedby")).toBe("phone-error");
    expect(screen.getByText("Enter the customer's phone number")).toBeTruthy();
  });

  it("goes to a field further down when the earlier ones are fine", () => {
    render(<TestForm validate={() => ({ phone: "This phone number is already used" })} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(document.activeElement).toBe(screen.getByLabelText("phone"));
  });

  it("scrolls again on every submit that still has errors", () => {
    render(<TestForm validate={() => ({ phone: "Enter the customer's phone number" })} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    screen.getByRole("button", { name: "Save" }).focus();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(scrolled).toHaveLength(2);
    expect(document.activeElement).toBe(screen.getByLabelText("phone"));
  });

  it("does nothing when the submit has no errors", () => {
    render(<TestForm validate={() => ({})} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(scrolled).toEqual([]);
  });
});
