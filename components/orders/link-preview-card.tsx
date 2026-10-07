import type { LinkPreview } from "@/lib/orders/link-preview";

type Props = { preview: LinkPreview | null; host: string | null };

/**
 * What the store's page said about the product. The picture stays on the
 * store's server and is shown with a plain <img> and no referrer: we do not
 * copy it, and next/image would route it through our server.
 */
export function LinkPreviewCard({ preview, host }: Props) {
  if (!preview) {
    return (
      <p className="text-muted-foreground text-sm">
        {host ? `Link from ${host}. ` : ""}No preview is available for this link.
      </p>
    );
  }
  return (
    <div className="flex gap-3">
      {preview.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- remote store picture, shown as is on purpose
        <img
          src={preview.imageUrl}
          alt=""
          width={80}
          height={80}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="bg-muted size-20 shrink-0 rounded-md object-cover"
        />
      ) : null}
      <div className="grid min-w-0 content-start gap-1">
        {preview.title ? (
          <p className="line-clamp-2 text-sm font-medium break-words">{preview.title}</p>
        ) : null}
        {preview.description ? (
          <p className="text-muted-foreground line-clamp-2 text-xs break-words">{preview.description}</p>
        ) : null}
        {host ? <p className="text-muted-foreground text-xs">{host}</p> : null}
      </div>
    </div>
  );
}
