import { describe, expect, it } from "vitest";

import {
  addSuggestion,
  describeRating,
  formatAverageRating,
  formatStars,
  getRatingLabel,
  getReviewSuggestions,
  getStarFillTenths,
  hasSuggestion,
  REVIEW_COMMENT_MAX,
  REVIEW_SUGGESTIONS,
} from "./reviews";

describe("getReviewSuggestions", () => {
  it("shows nothing before stars are chosen", () => {
    expect(getReviewSuggestions(null)).toEqual([]);
  });

  it("follows the stars: 5 or 4 good, 3 middle, 2 or 1 poor", () => {
    expect(getReviewSuggestions(5)).toEqual(["Clothes came back fresh", "Pickup was on time", "Friendly service", "Great value"]);
    expect(getReviewSuggestions(4)).toEqual(REVIEW_SUGGESTIONS.good);
    expect(getReviewSuggestions(3)).toEqual(["Good, but slow", "Some items need another wash", "Could communicate better"]);
    expect(getReviewSuggestions(2)).toEqual([
      "Pickup or delivery was late",
      "Items were damaged",
      "Clothes not properly cleaned",
      "Poor communication",
    ]);
    expect(getReviewSuggestions(1)).toEqual(REVIEW_SUGGESTIONS.poor);
  });

  it("shows nothing for a rating outside 1 to 5", () => {
    expect(getReviewSuggestions(0)).toEqual([]);
    expect(getReviewSuggestions(6)).toEqual([]);
    expect(getReviewSuggestions(4.5)).toEqual([]);
  });
});

describe("addSuggestion", () => {
  it("puts the chip alone into an empty comment", () => {
    expect(addSuggestion("", "Friendly service")).toBe("Friendly service");
    expect(addSuggestion("   ", "Friendly service")).toBe("Friendly service");
  });

  it("adds a chip after existing text with ' · ' in between", () => {
    expect(addSuggestion("Very good", "Friendly service")).toBe("Very good · Friendly service");
    expect(addSuggestion("Very good  ", "Friendly service")).toBe("Very good · Friendly service");
  });

  it("adds several chips in the order they are tapped", () => {
    const comment = addSuggestion(addSuggestion("", "Pickup was on time"), "Great value");
    expect(comment).toBe("Pickup was on time · Great value");
  });

  it("never adds a chip twice when it is already its own phrase", () => {
    expect(addSuggestion("Great value", "Great value")).toBe("Great value");
    expect(addSuggestion("Friendly service · Great value", "Great value")).toBe("Friendly service · Great value");
    expect(addSuggestion("Lovely. great  VALUE!", "Great value")).toBe("Lovely. great  VALUE!");
  });

  it("still adds a chip that typed text only contains", () => {
    expect(hasSuggestion("Great value for money", "Great value")).toBe(false);
    expect(addSuggestion("Great value for money", "Great value")).toBe("Great value for money · Great value");
  });

  it("adds nothing when the chip and its separator don't fit, never cutting it short", () => {
    const chip = "Friendly service";
    const exact = "a".repeat(REVIEW_COMMENT_MAX - chip.length - 3);
    expect(addSuggestion(exact, chip)).toBe(`${exact} · ${chip}`);
    expect(addSuggestion(exact, chip)).toHaveLength(REVIEW_COMMENT_MAX);

    const tooLong = `${exact}a`;
    expect(addSuggestion(tooLong, chip)).toBe(tooLong);
    const full = "a".repeat(REVIEW_COMMENT_MAX);
    expect(addSuggestion(full, chip)).toBe(full);
  });

  it("respects a smaller limit", () => {
    expect(addSuggestion("", "Great value", 5)).toBe("");
  });
});

describe("showing a rating", () => {
  it("writes stars, filled for the rating", () => {
    expect(formatStars(5)).toBe("★★★★★");
    expect(formatStars(4)).toBe("★★★★☆");
    expect(formatStars(1)).toBe("★☆☆☆☆");
  });

  it("fills the stars to the exact average, in tenths", () => {
    const fills = (rating: number) => [1, 2, 3, 4, 5].map((star) => getStarFillTenths(rating, star));
    expect(fills(4.5)).toEqual([10, 10, 10, 10, 5]);
    expect(fills(4.7)).toEqual([10, 10, 10, 10, 7]);
    expect(fills(3.1)).toEqual([10, 10, 10, 1, 0]);
    expect(fills(5)).toEqual([10, 10, 10, 10, 10]);
    expect(fills(1)).toEqual([10, 0, 0, 0, 0]);
  });

  it("describes it in words", () => {
    expect(describeRating(5)).toBe("5 out of 5");
    expect(getRatingLabel(1)).toBe("1 star");
    expect(getRatingLabel(3)).toBe("3 stars");
  });

  it("rounds averages to one decimal place", () => {
    expect(formatAverageRating(null)).toBeNull();
    expect(formatAverageRating(4)).toBe("4.0");
    expect(formatAverageRating(4.25)).toBe("4.3");
    expect(formatAverageRating(13 / 3)).toBe("4.3");
  });
});
