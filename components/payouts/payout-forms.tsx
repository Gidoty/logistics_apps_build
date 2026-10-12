"use client";

import { useState } from "react";
import { ActionForm } from "@/components/admin-orders/action-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { minorToDecimalString, parseMoneyInput } from "@/lib/money";
import { recordRefund, releaseToVendor } from "@/lib/payouts/actions";

/**
 * Release money after delivery. Changing the fee moves the amount so the two
 * add up to what is held; type over the amount to release less (a partial release).
 */
export function ReleaseForm({
  orderId,
  balanceMinor,
  amountLabel,
}: {
  orderId: string;
  balanceMinor: number;
  amountLabel: string;
}) {
  const [amount, setAmount] = useState(minorToDecimalString(balanceMinor, 2));
  const [fee, setFee] = useState("0.00");

  function onFeeChange(value: string) {
    setFee(value);
    const parsed =
      value.trim() === ""
        ? ({ ok: true, minor: 0 } as const)
        : parseMoneyInput(value, 2, { allowZero: true });
    if (parsed.ok) setAmount(minorToDecimalString(Math.max(balanceMinor - parsed.minor, 0), 2));
  }

  return (
    <ActionForm
      submitLabel="Record release"
      confirmText="Record this release? It cannot be undone."
      onSubmit={(data) =>
        releaseToVendor(
          orderId,
          String(data.get("amount") ?? ""),
          String(data.get("fee") ?? ""),
          String(data.get("reference") ?? ""),
        )
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="grid gap-1">
          <Label htmlFor="release-amount" className="text-xs">
            {amountLabel} (NGN)
          </Label>
          <Input
            id="release-amount"
            name="amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="release-fee" className="text-xs">
            Our fee (NGN)
          </Label>
          <Input
            id="release-fee"
            name="fee"
            inputMode="decimal"
            value={fee}
            onChange={(e) => onFeeChange(e.target.value)}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="release-ref" className="text-xs">
            Bank transfer reference
          </Label>
          <Input id="release-ref" name="reference" maxLength={200} autoComplete="off" required />
        </div>
      </div>
    </ActionForm>
  );
}

export function RefundForm({ orderId }: { orderId: string }) {
  return (
    <ActionForm
      submitLabel="Record refund"
      variant="destructive"
      confirmText="Record the refund of the full held balance and close the order as refunded?"
      onSubmit={(data) => recordRefund(orderId, String(data.get("reference") ?? ""))}
    >
      <div className="grid gap-1">
        <Label htmlFor="refund-ref" className="text-xs">
          Refund reference (bank transfer or Paystack dashboard)
        </Label>
        <Input id="refund-ref" name="reference" maxLength={200} autoComplete="off" required />
      </div>
    </ActionForm>
  );
}
