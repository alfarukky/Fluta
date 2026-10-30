import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ReviewCard } from "./ReviewCard";

const actions = vi.hoisted(() => ({ submitReview: vi.fn() }));
vi.mock("@/actions/reviews", () => ({ submitReview: actions.submitReview }));

const TOKEN = "t".repeat(43);

beforeEach(() => {
  vi.clearAllMocks();
});

function renderForm() {
  render(<ReviewCard token={TOKEN} review={{ kind: "form", storeName: "FreshFold Laundry" }} />);
  return screen.getByRole("textbox", { name: "Tell us more (optional)" }) as HTMLTextAreaElement;
}

function chooseStars(count: number) {
  fireEvent.click(screen.getByRole("radio", { name: count === 1 ? "1 star" : `${count} stars` }));
}

describe("ReviewCard", () => {
  it("asks how the laundry was, with nothing in the comment and no chips before the customer acts", () => {
    const comment = renderForm();
    expect(screen.getByRole("heading", { name: "How was your laundry?" })).toBeTruthy();
    expect(screen.getByText("Rate your experience with FreshFold Laundry.")).toBeTruthy();
    expect(comment.value).toBe("");
    expect(screen.getAllByRole("radio")).toHaveLength(5);
    expect(screen.queryByRole("button", { name: /Friendly service/ })).toBeNull();
  });

  it("offers the stars as a labelled choice of 1 to 5", () => {
    renderForm();
    expect(screen.getByRole("group", { name: "Your rating" })).toBeTruthy();
    chooseStars(4);
    expect((screen.getByRole("radio", { name: "4 stars" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("radio", { name: "5 stars" }) as HTMLInputElement).checked).toBe(false);
  });

  it("shows chips that follow the stars, and keeps the comment when the stars change", () => {
    const comment = renderForm();
    chooseStars(4);
    expect(comment.value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Pickup was on time" }));
    fireEvent.click(screen.getByRole("button", { name: "Great value" }));
    expect(comment.value).toBe("Pickup was on time · Great value");
    expect(screen.getByRole("button", { name: "Great value" }).getAttribute("aria-pressed")).toBe("true");

    // Tapping a chip again never adds it twice.
    fireEvent.click(screen.getByRole("button", { name: "Great value" }));
    expect(comment.value).toBe("Pickup was on time · Great value");

    chooseStars(2);
    expect(screen.queryByRole("button", { name: "Great value" })).toBeNull();
    expect(screen.getByRole("button", { name: "Items were damaged" })).toBeTruthy();
    expect(comment.value).toBe("Pickup was on time · Great value");

    chooseStars(3);
    expect(screen.getByRole("button", { name: "Good, but slow" })).toBeTruthy();
  });

  it("adds a chip after typed text", () => {
    const comment = renderForm();
    fireEvent.change(comment, { target: { value: "Very good" } });
    chooseStars(5);
    fireEvent.click(screen.getByRole("button", { name: "Friendly service" }));
    expect(comment.value).toBe("Very good · Friendly service");
  });

  it("asks for stars before submitting", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(screen.getByRole("alert").textContent).toBe("Choose a star rating");
    expect(actions.submitReview).not.toHaveBeenCalled();
  });

  it("submits the rating and comment, then thanks the customer", async () => {
    actions.submitReview.mockResolvedValue({ ok: true, message: "Thank you for your review", rating: 4 });
    const comment = renderForm();
    chooseStars(4);
    fireEvent.change(comment, { target: { value: "Lovely" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "Thank you for your review" })).toBeTruthy());
    expect(actions.submitReview).toHaveBeenCalledWith(TOKEN, { rating: 4, comment: "Lovely" });
    expect(screen.getByRole("img", { name: "You rated 4 out of 5" })).toBeTruthy();
  });

  it("thanks the customer with the stars already saved by an earlier submit", async () => {
    actions.submitReview.mockResolvedValue({ ok: true, message: "Thank you for your review", rating: 2 });
    renderForm();
    chooseStars(5);
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(screen.getByRole("img", { name: "You rated 2 out of 5" })).toBeTruthy());
  });

  it("shows the server's message when the review is refused", async () => {
    actions.submitReview.mockResolvedValue({ ok: false, message: "Reviews for this order closed 7 days after it was completed." });
    renderForm();
    chooseStars(5);
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Reviews for this order closed 7 days after it was completed."));
  });

  it("shows the thank-you card for a review already left", () => {
    render(<ReviewCard token={TOKEN} review={{ kind: "thanks", rating: 2 }} />);
    expect(screen.getByRole("heading", { name: "Thank you for your review" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "You rated 2 out of 5" })).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
