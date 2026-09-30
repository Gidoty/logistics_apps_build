import Image from "next/image";
import { getPublicEnv } from "@/lib/env";
import { productImageUrl } from "@/lib/storage/product-images";
import { cn } from "@/lib/utils";

type Props = {
  path: string | null;
  alt: string;
  /** Tells the browser how wide the image will be, so it downloads a small file on phones. */
  sizes: string;
  /** Preload the image. Use for the main image at the top of a page only. */
  preload?: boolean;
  className?: string;
};

/** A product photo that fills its parent box, or a plain placeholder when there is none. */
export function ProductImage({ path, alt, sizes, preload = false, className }: Props) {
  if (!path) {
    return (
      <div
        className={cn(
          "bg-muted text-muted-foreground flex size-full items-center justify-center text-xs",
          className,
        )}
      >
        No image
      </div>
    );
  }
  return (
    <Image
      src={productImageUrl(getPublicEnv().NEXT_PUBLIC_SUPABASE_URL, path)}
      alt={alt}
      fill
      sizes={sizes}
      preload={preload}
      className={cn("object-cover", className)}
    />
  );
}
