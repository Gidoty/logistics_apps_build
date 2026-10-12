import { describe, expect, it } from "vitest";
import {
  buildProofPath,
  parseVideoDurationSeconds,
  validateProofCounts,
  validateProofPhoto,
  validateProofVideo,
} from "@/lib/fulfilment/proof";

function box(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + body.length);
  new DataView(out.buffer).setUint32(0, out.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(body, 8);
  return out;
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
function mvhdV0(timescale: number, duration: number): Uint8Array {
  const body = new Uint8Array(100);
  const view = new DataView(body.buffer);
  view.setUint32(12, timescale);
  view.setUint32(16, duration);
  return box("mvhd", body);
}
function mvhdV1(timescale: number, duration: number): Uint8Array {
  const body = new Uint8Array(112);
  const view = new DataView(body.buffer);
  body[0] = 1;
  view.setUint32(20, timescale);
  view.setUint32(24, 0);
  view.setUint32(28, duration);
  return box("mvhd", body);
}
const ftyp = box("ftyp", new TextEncoder().encode("isom\0\0\0\0isom"));
const mdat = box("mdat", new Uint8Array(5000));

describe("parseVideoDurationSeconds", () => {
  it("reads the length when moov comes first", () => {
    expect(parseVideoDurationSeconds(concat(ftyp, box("moov", mvhdV0(1000, 12_500)), mdat))).toBe(13);
  });
  it("reads the length when moov comes after the video data", () => {
    expect(parseVideoDurationSeconds(concat(ftyp, mdat, box("moov", mvhdV0(600, 6000))))).toBe(10);
  });
  it("reads a version 1 header", () => {
    expect(parseVideoDurationSeconds(concat(ftyp, box("moov", mvhdV1(1000, 29_000))))).toBe(29);
  });
  it("returns null for files that are not MP4 or MOV", () => {
    expect(parseVideoDurationSeconds(new TextEncoder().encode("GIF89a not a video at all"))).toBeNull();
    expect(parseVideoDurationSeconds(new Uint8Array(0))).toBeNull();
    expect(parseVideoDurationSeconds(concat(ftyp, mdat))).toBeNull();
  });
  it("returns null for a zero timescale, a zero duration or a cut-off header", () => {
    expect(parseVideoDurationSeconds(concat(ftyp, box("moov", mvhdV0(0, 100))))).toBeNull();
    expect(parseVideoDurationSeconds(concat(ftyp, box("moov", mvhdV0(1000, 0))))).toBeNull();
    expect(parseVideoDurationSeconds(concat(ftyp, box("moov", box("mvhd", new Uint8Array(8)))))).toBeNull();
  });
  it("does not run past a box that claims to be larger than the file", () => {
    const lying = new Uint8Array(16);
    new DataView(lying.buffer).setUint32(0, 9_999_999);
    lying.set(new TextEncoder().encode("moov"), 4);
    expect(parseVideoDurationSeconds(concat(ftyp, lying))).toBeNull();
  });
});

describe("proof file checks", () => {
  it("accepts JPG, PNG and WebP photos only", () => {
    expect(validateProofPhoto({ type: "image/jpeg", size: 1000 })).toBeNull();
    expect(validateProofPhoto({ type: "image/gif", size: 1000 })).toMatch(/JPG, PNG or WebP/);
    expect(validateProofPhoto({ type: "image/png", size: 0 })).toMatch(/empty/);
    expect(validateProofPhoto({ type: "image/png", size: 11 * 1024 * 1024 })).toMatch(/10 MB/);
  });
  it("accepts MP4 and MOV videos up to 20 MB", () => {
    expect(validateProofVideo({ type: "video/mp4", size: 20 * 1024 * 1024 })).toBeNull();
    expect(validateProofVideo({ type: "video/quicktime", size: 1000 })).toBeNull();
    expect(validateProofVideo({ type: "video/webm", size: 1000 })).toMatch(/MP4 or MOV/);
    expect(validateProofVideo({ type: "video/mp4", size: 20 * 1024 * 1024 + 1 })).toMatch(/20 MB/);
  });
  it("needs 2 to 6 photos and at most one video", () => {
    expect(validateProofCounts(2, 0)).toBeNull();
    expect(validateProofCounts(6, 1)).toBeNull();
    expect(validateProofCounts(1, 0)).not.toBeNull();
    expect(validateProofCounts(7, 0)).not.toBeNull();
    expect(validateProofCounts(2, 2)).not.toBeNull();
  });
  it("builds a path from the checked type, never from a file name", () => {
    const order = "11111111-1111-4111-8111-111111111111";
    expect(buildProofPath(order, "image/jpeg", "abc")).toBe(`${order}/abc.jpg`);
    expect(buildProofPath(order, "video/quicktime", "abc")).toBe(`${order}/abc.mov`);
    expect(buildProofPath(order, "application/pdf", "abc")).toBeNull();
  });
});
