"use client";

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useRef, useState } from "react";
import { ProductImage } from "@/components/shop/product-image";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { attachProductImage, removeProductImage, reorderProductImages } from "@/lib/catalog/actions";
import { compressProductImage, ImageCompressionError } from "@/lib/storage/compress-image";
import {
  buildProductImagePath,
  PRODUCT_IMAGE_BUCKET,
  PRODUCT_IMAGE_MAX_PER_PRODUCT,
} from "@/lib/storage/product-images";
import { createClient } from "@/lib/supabase/client";

type Image = { id: string; storage_path: string };

type Props = { productId: string; vendorId: string; initialImages: Image[] };

function SortableImage({
  image,
  index,
  total,
  busy,
  onMove,
  onRemove,
}: {
  image: Image;
  index: number;
  total: number;
  busy: boolean;
  onMove: (from: number, to: number) => void;
  onRemove: (image: Image) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: image.id,
  });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`bg-card grid gap-2 rounded-lg border p-2 ${isDragging ? "z-10 shadow-lg" : ""}`}
    >
      <div
        // Drag here. The arrow buttons below do the same without dragging.
        {...attributes}
        {...listeners}
        className="bg-muted relative aspect-square cursor-grab touch-none overflow-hidden rounded-md active:cursor-grabbing"
        aria-label={`Photo ${index + 1} of ${total}. Drag to reorder, or use the arrow keys.`}
      >
        <ProductImage path={image.storage_path} alt={`Photo ${index + 1}`} sizes="160px" />
        {index === 0 ? (
          <Badge className="absolute top-1 left-1" variant="default">
            Main photo
          </Badge>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy || index === 0}
          onClick={() => onMove(index, index - 1)}
          aria-label={`Move photo ${index + 1} earlier`}
        >
          ←
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => onRemove(image)}
          aria-label={`Remove photo ${index + 1}`}
        >
          Remove
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy || index === total - 1}
          onClick={() => onMove(index, index + 1)}
          aria-label={`Move photo ${index + 1} later`}
        >
          →
        </Button>
      </div>
    </li>
  );
}

/**
 * Upload, remove and reorder product photos. Each photo is compressed in the
 * browser (longest side 1600px, WebP, under about 300 KB), uploaded straight to
 * storage under <vendor_id>/<product_id>/, then recorded by a server action.
 */
export function ImageManager({ productId, vendorId, initialImages }: Props) {
  const [images, setImages] = useState<Image[]>(initialImages);
  const [status, setStatus] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // A short press before dragging, so scrolling the page with a finger still works.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const room = PRODUCT_IMAGE_MAX_PER_PRODUCT - images.length;

  async function saveOrder(next: Image[], previous: Image[]) {
    setImages(next);
    const result = await reorderProductImages(
      productId,
      next.map((image) => image.id),
    );
    if (!result.ok) {
      setImages(previous);
      setProblems([result.message]);
    }
  }

  function move(from: number, to: number) {
    setProblems([]);
    void saveOrder(arrayMove(images, from, to), images);
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = images.findIndex((image) => image.id === active.id);
    const to = images.findIndex((image) => image.id === over.id);
    if (from >= 0 && to >= 0) move(from, to);
  }

  async function remove(image: Image) {
    if (!window.confirm("Remove this photo?")) return;
    setBusy(true);
    setProblems([]);
    const result = await removeProductImage(image.id);
    if (result.ok) setImages((current) => current.filter((item) => item.id !== image.id));
    else setProblems([result.message]);
    setBusy(false);
  }

  async function onPick(files: FileList | null) {
    if (!files || files.length === 0) return;
    const picked = Array.from(files);
    const accepted = picked.slice(0, Math.max(room, 0));
    const problemsFound: string[] = [];
    if (picked.length > accepted.length) {
      problemsFound.push(
        `A product can have ${PRODUCT_IMAGE_MAX_PER_PRODUCT} photos. ${picked.length - accepted.length} file(s) were skipped.`,
      );
    }

    setBusy(true);
    setProblems([]);
    const supabase = createClient();

    for (const [index, file] of accepted.entries()) {
      const label = `${file.name || `Photo ${index + 1}`}`;
      try {
        setStatus(`Preparing ${label} (${index + 1} of ${accepted.length})...`);
        const compressed = await compressProductImage(file);
        const path = buildProductImagePath(vendorId, productId, compressed.mimeType);

        setStatus(`Uploading ${label} (${index + 1} of ${accepted.length})...`);
        const { error } = await supabase.storage
          .from(PRODUCT_IMAGE_BUCKET)
          .upload(path, compressed.blob, { contentType: compressed.mimeType, upsert: false });
        if (error) throw new Error("upload");

        const saved = await attachProductImage(productId, path);
        if (!saved.ok) throw new ImageCompressionError(saved.message);
        setImages((current) => [...current, { id: saved.image.id, storage_path: saved.image.storage_path }]);
      } catch (error) {
        problemsFound.push(
          error instanceof ImageCompressionError
            ? `${label}: ${error.message}`
            : `${label}: upload failed. Check your connection and try again.`,
        );
      }
    }

    setProblems(problemsFound);
    setStatus(null);
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <section aria-labelledby="photos-heading" className="grid gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="photos-heading" className="text-lg font-semibold">
          Photos
        </h2>
        <span className="text-muted-foreground text-sm">
          {images.length} of {PRODUCT_IMAGE_MAX_PER_PRODUCT}
        </span>
      </div>
      <p className="text-muted-foreground text-sm">
        The first photo is the main photo. Drag photos, or use the arrows, to change the order. Photos are
        shrunk on your phone before upload, so they load fast for buyers.
      </p>

      {problems.length > 0 ? (
        <Alert variant="destructive">
          <ul className="grid gap-1">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
      {status ? (
        <p role="status" className="text-muted-foreground text-sm">
          {status}
        </p>
      ) : null}

      {images.length > 0 ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={images.map((image) => image.id)} strategy={rectSortingStrategy}>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {images.map((image, index) => (
                <SortableImage
                  key={image.id}
                  image={image}
                  index={index}
                  total={images.length}
                  busy={busy}
                  onMove={move}
                  onRemove={remove}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      ) : (
        <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-8 text-center text-sm">
          No photos yet. Add at least one to publish this product.
        </p>
      )}

      <div className="grid gap-1">
        <input
          ref={inputRef}
          id="photo-input"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="sr-only"
          disabled={busy || room <= 0}
          onChange={(event) => void onPick(event.target.files)}
        />
        <Button
          type="button"
          variant="outline"
          disabled={busy || room <= 0}
          onClick={() => inputRef.current?.click()}
        >
          {room <= 0 ? "Photo limit reached" : busy ? "Working..." : "Add photos"}
        </Button>
        <p className="text-muted-foreground text-xs">JPG, PNG or WebP, up to 5 MB each.</p>
      </div>
    </section>
  );
}
