"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { userFacingDbError } from "@/lib/db-errors";
import { formError, fromZodError, type FormState } from "@/lib/form-state";
import { isPricingError } from "@/lib/pricing/errors";
import { parcelFor } from "@/lib/pricing/parcel";
import { publicPricingMessage } from "@/lib/pricing/public-errors";
import { calculateFromRequest } from "@/lib/pricing/service";
import { listRegionNames } from "@/lib/recipients/queries";
import { createRecipientSchema, readRecipientFields } from "@/lib/recipients/schemas";
import { listActiveCurrencies } from "@/lib/reference/queries";
import type { Json } from "@/lib/supabase/database.types";
import { createPublicClient } from "@/lib/supabase/public";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { wholeNumber } from "@/lib/validation";

const checkoutSchema = z.object({
  productId: z.uuid("Product not found."),
  quantity: wholeNumber("Quantity", 1, 100),
  recipientId: z.string().trim(),
  buyerCurrency: z.string().trim().toUpperCase(),
});

function prefix(errors: Record<string, string[]> | undefined, by: string) {
  return Object.fromEntries(Object.entries(errors ?? {}).map(([key, value]) => [`${by}${key}`, value]));
}

/**
 * Buy button to order. The price is worked out here by the pricing engine from
 * the product's price in the database; nothing in the form decides it. The
 * order and its 30-minute quote are created by a database function that only
 * the server can call. The buyer then lands on the order page to check the
 * total and pay.
 */
export async function createCatalogCheckout(_prev: FormState, formData: FormData): Promise<FormState> {
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };
  const productId = text("productId");
  const user = await requireUser(`/checkout/${productId}`);

  const [currencies, states] = await Promise.all([listActiveCurrencies(), listRegionNames("NG")]);
  const parsed = checkoutSchema.safeParse({
    productId,
    quantity: text("quantity"),
    recipientId: text("recipientId"),
    buyerCurrency: text("buyerCurrency"),
  });
  const creating = text("recipientId") === "new";
  const recipientResult = creating
    ? createRecipientSchema(states).safeParse(readRecipientFields(formData, "recipient_"))
    : null;

  const fieldErrors: Record<string, string[]> = {};
  if (!parsed.success) Object.assign(fieldErrors, fromZodError(parsed.error).fieldErrors);
  else if (!currencies.some((c) => c.code === parsed.data.buyerCurrency))
    fieldErrors.buyerCurrency = ["Choose a currency."];
  else if (!creating && !z.uuid().safeParse(parsed.data.recipientId).success)
    fieldErrors.recipientId = ["Choose a recipient."];
  if (recipientResult && !recipientResult.success)
    Object.assign(fieldErrors, prefix(fromZodError(recipientResult.error).fieldErrors, "recipient_"));
  if (Object.keys(fieldErrors).length > 0 || !parsed.success) {
    return { status: "error", message: "Please fix the highlighted fields.", fieldErrors };
  }
  const input = parsed.data;

  const { data: product, error: productError } = await createPublicClient()
    .from("products")
    .select(
      "id, title, price_minor, currency, stock, weight_grams, length_cm, width_cm, height_cm, category, corridor_id, requires_special_handling",
    )
    .eq("id", input.productId)
    .maybeSingle();
  if (productError) return formError("We could not load the product. Please try again.");
  if (!product) return formError("This product is not available.");
  if (product.weight_grams === null)
    return formError("Delivered price on request. Please ask for a quote instead.");
  if (product.stock < input.quantity) {
    return {
      status: "error",
      message: product.stock <= 0 ? "This item is out of stock." : `Only ${product.stock} left.`,
      fieldErrors: { quantity: [`Only ${product.stock} in stock.`] },
    };
  }

  const supabase = await createClient();
  let recipientId = input.recipientId;
  let destinationState: string;
  if (recipientResult?.success) {
    const r = recipientResult.data;
    destinationState = r.state;
    const created = await supabase
      .from("recipients")
      .insert({
        full_name: r.fullName,
        phone: r.phone,
        email: r.email,
        address_line: r.addressLine,
        city: r.city,
        state: r.state,
        landmark: r.landmark,
        country_code: "NG",
      })
      .select("id")
      .single();
    if (created.error)
      return formError(
        userFacingDbError(created.error, "We could not save the recipient. Please try again."),
      );
    recipientId = created.data.id;
  } else {
    const found = await supabase
      .from("recipients")
      .select("state")
      .eq("id", recipientId)
      .eq("archived", false)
      .maybeSingle();
    if (found.error || !found.data)
      return {
        status: "error",
        message: "Choose one of your recipients.",
        fieldErrors: { recipientId: ["Choose a recipient."] },
      };
    destinationState = found.data.state;
  }

  const unitBox =
    product.length_cm !== null && product.width_cm !== null && product.height_cm !== null
      ? {
          length: Number(product.length_cm),
          width: Number(product.width_cm),
          height: Number(product.height_cm),
        }
      : null;
  const parcel = parcelFor(product.weight_grams, unitBox, input.quantity);

  let landed;
  try {
    landed = await calculateFromRequest({
      itemUnitPriceMinor: product.price_minor,
      itemCurrency: product.currency,
      quantity: input.quantity,
      actualWeightGrams: parcel.weightGrams,
      dimensionsCm: parcel.dimensionsCm,
      categorySlug: product.category,
      corridorId: product.corridor_id,
      destinationState,
      buyerCurrency: input.buyerCurrency,
      specialHandling: product.requires_special_handling,
    });
  } catch (error) {
    if (isPricingError(error)) return formError(`${publicPricingMessage(error)}`);
    console.error("Checkout pricing failed", error);
    return formError("We could not work out the price. Please try again.");
  }

  const { data: orderId, error } = await createServiceClient().rpc("create_catalog_order", {
    _buyer: user.id,
    _product_id: product.id,
    _quantity: input.quantity,
    _recipient_id: recipientId,
    _buyer_currency: input.buyerCurrency,
    _lines: landed.lines.map((line) => ({
      type: line.type,
      label: line.label,
      amount_minor: line.amountMinor,
    })) as unknown as Json,
    _snapshot: landed.snapshot as unknown as Json,
    _weight_grams: parcel.weightGrams,
  });
  if (error) return formError(userFacingDbError(error, "We could not create your order. Please try again."));

  revalidatePath("/account/orders");
  redirect(`/account/orders/${orderId}?new=1`);
}
