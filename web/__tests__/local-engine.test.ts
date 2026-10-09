import { describe, expect, test } from "bun:test";

import { explainLoadError } from "../src/local/engine.ts";

describe("explainLoadError", () => {
  test("a blocked or offline download names the hosts and the likely cause", () => {
    const text = explainLoadError(new TypeError("Failed to fetch"));
    expect(text).toContain("Hugging Face");
    expect(text).toContain("online");
  });

  test("a GPU allocation failure is reported as running out of memory", () => {
    expect(explainLoadError(new Error("Out of memory while creating buffer"))).toContain("ran out of memory");
    expect(explainLoadError(new Error("Device was lost during load"))).toContain("ran out of memory");
  });

  test("a storage quota error says to free space", () => {
    expect(explainLoadError(new Error("QuotaExceededError"))).toContain("room left");
  });

  test("anything unrecognised passes through untouched", () => {
    expect(explainLoadError(new Error("shader compile failed"))).toBe("shader compile failed");
    expect(explainLoadError("plain string")).toBe("plain string");
  });
});
