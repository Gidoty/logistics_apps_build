import { parseMoneyInput } from "@/lib/money";
import type { EngineLineType } from "@/lib/pricing/types";

/** A line as the admin form sends it. `calcType` ties it to a line the engine produced. */
export type SubmittedLine = {
  calcType: EngineLineType | null;
  label: string;
  /** Amount in the buyer's currency, as typed. */
  amount: string;
  /** Why the amount differs from the calculation, or why a manual line was added. */
  reason: string;
};

export type CalculatedLine = { type: EngineLineType; label: string; amountMinor: number };

/** A line in the shape send_quote() takes. */
export type SqlQuoteLine = {
  type: string;
  label: string;
  amount_minor: number;
  override?: { reason: string; original_amount_minor: number | null };
};

export const MIN_REASON_LENGTH = 5;
export const MAX_REASON_LENGTH = 500;
export const MAX_MANUAL_LINES = 5;

export type ReconcileResult = { ok: true; lines: SqlQuoteLine[] } | { ok: false; errors: string[] };

/**
 * Checks the lines an admin wants to send against what the engine calculated.
 * Every calculated line must be there once. An amount that differs is an
 * override: it needs a reason, and the calculated amount is kept as the
 * original. A line the engine did not produce is a manual line (type "other")
 * and needs a reason too. Nothing the admin changes is ever silent.
 */
export function reconcileLines(
  calculated: readonly CalculatedLine[],
  submitted: readonly SubmittedLine[],
  currencyDigits: number,
): ReconcileResult {
  const errors: string[] = [];
  const lines: SqlQuoteLine[] = [];
  const seen = new Set<string>();
  let manual = 0;

  submitted.forEach((line, index) => {
    const row = `Line ${index + 1}`;
    const amount = parseMoneyInput(line.amount, currencyDigits, { allowZero: true });
    if (!amount.ok) {
      errors.push(`${row}: ${amount.error}`);
      return;
    }
    const reason = line.reason.trim();

    if (line.calcType === null) {
      manual += 1;
      const label = line.label.trim();
      if (label.length < 1 || label.length > 200)
        errors.push(`${row}: give the line a label of up to 200 characters.`);
      if (amount.minor <= 0) errors.push(`${row}: a manual line needs an amount above zero.`);
      if (reason.length < MIN_REASON_LENGTH || reason.length > MAX_REASON_LENGTH)
        errors.push(`${row}: say why you added this line (at least ${MIN_REASON_LENGTH} characters).`);
      lines.push({
        type: "other",
        label,
        amount_minor: amount.minor,
        override: { reason, original_amount_minor: null },
      });
      return;
    }

    const original = calculated.find((c) => c.type === line.calcType);
    if (!original || seen.has(line.calcType)) {
      errors.push(`${row}: this line does not match the calculation. Calculate again.`);
      return;
    }
    seen.add(line.calcType);
    if (amount.minor === original.amountMinor) {
      lines.push({ type: original.type, label: original.label, amount_minor: original.amountMinor });
      return;
    }
    if (reason.length < MIN_REASON_LENGTH || reason.length > MAX_REASON_LENGTH) {
      errors.push(
        `${row} (${original.label}): you changed the amount, so give a reason (at least ${MIN_REASON_LENGTH} characters).`,
      );
      return;
    }
    lines.push({
      type: original.type,
      label: original.label,
      amount_minor: amount.minor,
      override: { reason, original_amount_minor: original.amountMinor },
    });
  });

  for (const c of calculated) {
    if (!seen.has(c.type))
      errors.push(
        `${c.label} is missing. Every calculated line must stay; set it to 0 with a reason instead.`,
      );
  }
  if (manual > MAX_MANUAL_LINES) errors.push(`Add at most ${MAX_MANUAL_LINES} manual lines.`);

  return errors.length > 0 ? { ok: false, errors } : { ok: true, lines };
}
