import { describe, expect, it } from "vitest";
import { normalizePhone } from "./phone";

describe("normalizePhone", () => {
  it.each([
    ["+2348031234567", "+2348031234567"],
    ["+234 803 123 4567", "+2348031234567"],
    ["+44 (7700) 900-123", "+447700900123"],
    ["002348031234567", "+2348031234567"],
    ["  +1 415.555.0100 ", "+14155550100"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each([
    ["local Nigerian format", "08031234567"],
    ["leading zero after plus", "+0803123456"],
    ["too short", "+234803"],
    ["too long", "+1234567890123456"],
    ["letters", "+234803ABC4567"],
    ["empty", ""],
  ])("rejects %s", (_label, input) => {
    expect(normalizePhone(input)).toBeNull();
  });
});
