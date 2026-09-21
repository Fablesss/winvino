import { describe, expect, it } from "vitest";
import { isTelegramLaunchHash } from "./telegram";

describe("isTelegramLaunchHash", () => {
  it.each([
    ["#tgWebAppData=query_id%3DAA&tgWebAppVersion=8.0&tgWebAppPlatform=ios", true],
    ["#tgWebAppPlatform=tdesktop", true],
    ["#foo=1&tgWebAppVersion=7.10", true],
    ["", false],
    ["#section-tgWebAppData", false],
  ])("%s → %s", (hash, expected) => {
    expect(isTelegramLaunchHash(hash)).toBe(expected);
  });
});
