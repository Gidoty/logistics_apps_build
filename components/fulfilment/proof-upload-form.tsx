"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { submitInspectionProof } from "@/lib/fulfilment/actions";
import {
  buildProofPath,
  INSPECTION_BUCKET,
  INSPECTION_MAX_PHOTOS,
  INSPECTION_MIN_PHOTOS,
  validateProofCounts,
  validateProofPhoto,
  validateProofVideo,
  type InspectionMediaItem,
} from "@/lib/fulfilment/proof";
import { compressProductImage, ImageCompressionError } from "@/lib/storage/compress-image";
import { createClient } from "@/lib/supabase/client";

/**
 * Photos are compressed in the browser, then everything goes straight to the
 * private bucket under <order id>/. A server action then records the proof and
 * checks the video length.
 */
export function ProofUploadForm({ orderId }: { orderId: string }) {
  const router = useRouter();
  const photoInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const photos = Array.from(photoInput.current?.files ?? []);
    const video = videoInput.current?.files?.[0] ?? null;

    const countProblem = validateProofCounts(photos.length, video ? 1 : 0);
    if (countProblem) return setError(countProblem);
    const fileProblem =
      photos.map(validateProofPhoto).find(Boolean) ?? (video ? validateProofVideo(video) : null);
    if (fileProblem) return setError(fileProblem);

    setBusy(true);
    try {
      const supabase = createClient();
      const media: InspectionMediaItem[] = [];
      const upload = async (blob: Blob, type: string, kind: "image" | "video") => {
        const path = buildProofPath(orderId, type);
        if (!path) throw new Error("type");
        const { error: uploadError } = await supabase.storage
          .from(INSPECTION_BUCKET)
          .upload(path, blob, { contentType: type, upsert: false });
        if (uploadError) throw new Error("upload");
        media.push({ path, type: kind });
      };
      for (const photo of photos) {
        const compressed = await compressProductImage(photo, validateProofPhoto);
        await upload(compressed.blob, compressed.mimeType, "image");
      }
      if (video) await upload(video, video.type, "video");

      const result = await submitInspectionProof({
        orderId,
        media,
        serial: String(form.get("serial") ?? ""),
        notes: String(form.get("notes") ?? ""),
      });
      if (!result.ok) return setError(result.message);
      setDone(result.message);
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof ImageCompressionError
          ? caught.message
          : "An upload failed. Check your connection and try again. Files already sent are ignored.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (done) return <Alert variant="success">{done}</Alert>;

  return (
    <form className="grid gap-3" noValidate onSubmit={onSubmit}>
      {error ? (
        <Alert variant="destructive" aria-live="polite">
          {error}
        </Alert>
      ) : null}
      <div className="grid gap-1">
        <Label htmlFor={`photos-${orderId}`}>
          Photos ({INSPECTION_MIN_PHOTOS} to {INSPECTION_MAX_PHOTOS})
        </Label>
        <Input
          id={`photos-${orderId}`}
          ref={photoInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          disabled={busy}
        />
        <p className="text-muted-foreground text-xs">
          Show the item powered on, the serial number or IMEI, and the sealed packaging.
        </p>
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`video-${orderId}`}>Video (optional, MP4 or MOV, up to 30 seconds and 20 MB)</Label>
        <Input
          id={`video-${orderId}`}
          ref={videoInput}
          type="file"
          accept="video/mp4,video/quicktime"
          disabled={busy}
        />
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`serial-${orderId}`}>Serial number or IMEI</Label>
        <Input id={`serial-${orderId}`} name="serial" maxLength={100} autoComplete="off" disabled={busy} />
        <p className="text-muted-foreground text-xs">Write N/A if the item has none.</p>
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`notes-${orderId}`}>Notes (optional)</Label>
        <Textarea id={`notes-${orderId}`} name="notes" rows={3} maxLength={5000} disabled={busy} />
      </div>
      <div>
        <Button type="submit" disabled={busy} aria-busy={busy}>
          {busy ? "Uploading..." : "Send proof to the buyer"}
        </Button>
      </div>
    </form>
  );
}
