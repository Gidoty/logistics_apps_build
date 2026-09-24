import { describe, expect, it } from "vitest";
import { z } from "zod";
import { fromZodError, readText } from "./form-state";

describe("form-state helpers", () => {
  it("groups zod issues by field", () => {
    const schema = z.object({ email: z.email(), name: z.string().min(2) });
    const result = schema.safeParse({ email: "x", name: "a" });
    if (result.success) throw new Error("expected failure");
    const state = fromZodError(result.error);
    expect(state.status).toBe("error");
    expect(Object.keys(state.fieldErrors ?? {}).sort()).toEqual(["email", "name"]);
  });

  it("reads text fields and ignores files", () => {
    const data = new FormData();
    data.set("name", "Ada");
    data.set("file", new Blob(["x"]), "x.txt");
    expect(readText(data, "name")).toBe("Ada");
    expect(readText(data, "file")).toBe("");
    expect(readText(data, "missing")).toBe("");
  });
});
