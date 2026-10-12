/**
 * Rules for inspection proof uploads. They mirror the `inspection-media`
 * bucket and `submit_inspection()` in supabase/migrations/20261022000200_fulfilment.sql.
 * The database checks counts, sizes and paths again, so this file only gives
 * instant feedback and reads the video length (the database cannot).
 *
 * Path layout: <order_id>/<random>.<jpg|png|webp|mp4|mov>
 */
export const INSPECTION_BUCKET = "inspection-media";
export const INSPECTION_MIN_PHOTOS = 2;
export const INSPECTION_MAX_PHOTOS = 6;
export const INSPECTION_MAX_VIDEOS = 1;
export const INSPECTION_VIDEO_MAX_BYTES = 20 * 1024 * 1024;
export const INSPECTION_VIDEO_MAX_SECONDS = 30;
/** Largest photo a person may pick. Photos are compressed in the browser before upload. */
export const INSPECTION_PHOTO_MAX_ORIGINAL_BYTES = 10 * 1024 * 1024;

const PHOTO_EXTENSIONS = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;
const VIDEO_EXTENSIONS = { "video/mp4": "mp4", "video/quicktime": "mov" } as const;

export type InspectionMediaType = "image" | "video";
export type InspectionMediaItem = { path: string; type: InspectionMediaType };

export function isPhotoMime(value: string): value is keyof typeof PHOTO_EXTENSIONS {
  return Object.hasOwn(PHOTO_EXTENSIONS, value);
}
export function isVideoMime(value: string): value is keyof typeof VIDEO_EXTENSIONS {
  return Object.hasOwn(VIDEO_EXTENSIONS, value);
}

export function validateProofPhoto(file: { type: string; size: number }): string | null {
  if (!isPhotoMime(file.type)) return "Photos must be JPG, PNG or WebP.";
  if (file.size <= 0) return "That file is empty.";
  if (file.size > INSPECTION_PHOTO_MAX_ORIGINAL_BYTES) return "Each photo must be smaller than 10 MB.";
  return null;
}

export function validateProofVideo(file: { type: string; size: number }): string | null {
  if (!isVideoMime(file.type)) return "The video must be MP4 or MOV.";
  if (file.size <= 0) return "That file is empty.";
  if (file.size > INSPECTION_VIDEO_MAX_BYTES) return "The video must be 20 MB or smaller.";
  return null;
}

export function buildProofPath(
  orderId: string,
  mimeType: string,
  fileId: string = crypto.randomUUID(),
): string | null {
  if (isPhotoMime(mimeType)) return `${orderId}/${fileId}.${PHOTO_EXTENSIONS[mimeType]}`;
  if (isVideoMime(mimeType)) return `${orderId}/${fileId}.${VIDEO_EXTENSIONS[mimeType]}`;
  return null;
}

/** Checks the counts the same way the database does. Returns a message, or null. */
export function validateProofCounts(photos: number, videos: number): string | null {
  if (photos < INSPECTION_MIN_PHOTOS || photos > INSPECTION_MAX_PHOTOS || videos > INSPECTION_MAX_VIDEOS) {
    return `Add ${INSPECTION_MIN_PHOTOS} to ${INSPECTION_MAX_PHOTOS} photos and at most one video.`;
  }
  return null;
}

/**
 * Reads the length in whole seconds (rounded up) from an MP4 or MOV file by
 * finding the `mvhd` box inside `moov`. Returns null when the file does not
 * look like one. Only box headers are read, never the video data.
 */
export function parseVideoDurationSeconds(bytes: Uint8Array): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fourcc = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));

  function boxes(start: number, end: number): { type: string; body: number; end: number }[] {
    const found: { type: string; body: number; end: number }[] = [];
    let at = start;
    while (at + 8 <= end) {
      let size = view.getUint32(at);
      let header = 8;
      if (size === 1) {
        if (at + 16 > end) break;
        const high = view.getUint32(at + 8);
        const low = view.getUint32(at + 12);
        size = high * 2 ** 32 + low;
        header = 16;
      } else if (size === 0) {
        size = end - at;
      }
      if (size < header || at + size > end) break;
      found.push({ type: fourcc(at + 4), body: at + header, end: at + size });
      at += size;
    }
    return found;
  }

  const top = boxes(0, bytes.byteLength);
  if (!top.some((box) => box.type === "ftyp" || box.type === "moov")) return null;
  const moov = top.find((box) => box.type === "moov");
  if (!moov) return null;
  const mvhd = boxes(moov.body, moov.end).find((box) => box.type === "mvhd");
  if (!mvhd || mvhd.body + 4 > mvhd.end) return null;

  const version = view.getUint8(mvhd.body);
  let timescale: number;
  let duration: number;
  if (version === 1) {
    if (mvhd.body + 32 > mvhd.end) return null;
    timescale = view.getUint32(mvhd.body + 20);
    duration = view.getUint32(mvhd.body + 24) * 2 ** 32 + view.getUint32(mvhd.body + 28);
  } else {
    if (mvhd.body + 20 > mvhd.end) return null;
    timescale = view.getUint32(mvhd.body + 12);
    duration = view.getUint32(mvhd.body + 16);
  }
  if (timescale === 0 || duration === 0) return null;
  return Math.ceil(duration / timescale);
}
