import { describe, it, expect } from "vitest";
import { validate, CreateItemSchema, AddCommentSchema } from "../schemas.js";

describe("validate()", () => {
  it("returns parsed data on success", () => {
    const result = validate(CreateItemSchema, { title: "My task" });
    expect(result.title).toBe("My task");
  });

  it("throws Validation error with field path on invalid input", () => {
    expect(() => validate(CreateItemSchema, { title: "" }))
      .toThrow(/Validation error/);
  });

  it("includes field path in error message", () => {
    expect(() => validate(AddCommentSchema, { body: "" }))
      .toThrow(/body:/);
  });

  it("uses 'body' fallback in error when issue has no path (top-level type error)", () => {
    // Passing null triggers an issue with an empty path array
    expect(() => validate(CreateItemSchema, null))
      .toThrow(/body:/);
  });
});
