import { describe, expect, it } from "vitest";
import {
  describeHold,
  findProhibitedTerms,
  PROHIBITED_TERMS,
  productTextToScan,
  scanProduct,
} from "@/lib/catalog/prohibited";

describe("findProhibitedTerms", () => {
  it.each([
    ["Genuine iPhone replica with box", ["replica"]],
    ["FIREARM cleaning kit", ["firearm"]],
    ["AirPods Pro, first copy, 1 year warranty", ["first copy"]],
    ["super copy and knock-off watches", ["knock-off", "super copy"]],
    ["Fireworks, pepper spray and a stun gun", ["fireworks", "pepper spray", "stun gun"]],
    ["clone. fake! (replica)", ["clone", "fake", "replica"]],
  ])("flags %s", (text, expected) => {
    expect(findProhibitedTerms(text)).toEqual(expected);
  });

  it.each([
    "Samsung Galaxy S24 Ultra 256GB, sealed",
    "Methane detector for the kitchen",
    "Rifled barrel cleaning pad",
    "Heat gun 2000W with two nozzles",
    "Bullet security camera 1080p",
    "Cloned repositories backup drive",
    "Fakery-free honest seller",
    "",
  ])("does not flag %s", (text) => {
    expect(findProhibitedTerms(text)).toEqual([]);
  });

  it("matches whole words only, not parts of words", () => {
    expect(findProhibitedTerms("methods and methodology")).toEqual([]);
    expect(findProhibitedTerms("a meth lab")).toEqual(["meth"]);
  });

  it("reports each term once", () => {
    expect(findProhibitedTerms("fake fake FAKE")).toEqual(["fake"]);
  });

  it("has a list of unique, lower-case terms", () => {
    expect(new Set(PROHIBITED_TERMS).size).toBe(PROHIBITED_TERMS.length);
    for (const term of PROHIBITED_TERMS) expect(term).toBe(term.toLowerCase());
  });
});

describe("scanProduct", () => {
  it("checks title, description, brand, condition notes and spec values", () => {
    expect(scanProduct({ title: "Phone", description: "Clean phone", brand: "Replica Mobile" })).toEqual([
      "replica",
    ]);
    expect(
      scanProduct({ title: "Phone", description: "Clean phone", conditionNotes: "Fake screen" }),
    ).toEqual(["fake"]);
    expect(
      scanProduct({ title: "Phone", description: "Clean phone", specs: { Origin: "Super copy" } }),
    ).toEqual(["super copy"]);
    expect(scanProduct({ title: "Counterfeit phone", description: "Nothing else here" })).toEqual([
      "counterfeit",
    ]);
  });

  it("passes a normal listing", () => {
    expect(
      scanProduct({
        title: "EcoFlow River 2 Pro Power Station",
        description: "768Wh portable power station with solar input.",
        brand: "EcoFlow",
        specs: { Capacity: "768 Wh" },
      }),
    ).toEqual([]);
  });

  it("joins only the fields that are present", () => {
    expect(productTextToScan({ title: "A", description: "B", brand: null, specs: { k: "C" } })).toBe("A B C");
  });
});

describe("describeHold", () => {
  it("names the matched words", () => {
    expect(describeHold(["fake", "replica"])).toContain("fake, replica");
  });
});
