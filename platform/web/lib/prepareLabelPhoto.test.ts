import { describe, expect, it } from "vitest";
import { fitWithinSide } from "./prepareLabelPhoto";

describe("fitWithinSide", () => {
  it("shrinksLongSideKeepingAspect", () => {
    expect(fitWithinSide(4032, 3024, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithinSide(3024, 4032, 1600)).toEqual({ width: 1200, height: 1600 });
  });

  it("neverUpscales", () => {
    expect(fitWithinSide(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });
});
