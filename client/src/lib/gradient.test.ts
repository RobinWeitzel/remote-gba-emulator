import { describe, it, expect } from "vitest";
import { gradientForName } from "./gradient";

describe("gradientForName", () => {
  it("returns a CSS linear-gradient string", () => {
    const g = gradientForName("Emerald");
    expect(g).toMatch(/^linear-gradient\(/);
  });
  it("is deterministic for the same input", () => {
    expect(gradientForName("Emerald")).toBe(gradientForName("Emerald"));
  });
  it("differs for different inputs", () => {
    expect(gradientForName("Emerald")).not.toBe(gradientForName("Sapphire"));
  });
});
