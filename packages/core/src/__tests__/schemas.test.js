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

  it("includes field name in error message when field has a path", () => {
    expect(() => validate(AddCommentSchema, { body: "" }))
      .toThrow(/body/);
  });

  it("throws with 'body' fallback when no path exists on the issue", () => {
    // A top-level non-object input triggers an issue with empty path
    expect(() => validate(CreateItemSchema, null))
      .toThrow(/body/);
  });

  it("includes field name in error for string length violation", () => {
    let err;
    try {
      validate(CreateItemSchema, { title: "x".repeat(256) });
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err.message).toContain("title");
  });
});
