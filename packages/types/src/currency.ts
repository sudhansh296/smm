/**
 * Currency conversion utilities shared across api, worker, and web packages.
 * All amounts in these functions use plain numbers — Decimal handling is
 * done at the DB/service layer using the `decimal.js` library.
 */

/**
 * Computes the effective INR rate applied to deposits.
 * markup increases the rate so customers get fewer USD per INR deposited.
 * effectiveRate = baseRate × (1 + markupPercent / 100)
 *
 * Example: baseRate=88, markupPercent=5
 *   → effectiveRate = 88 × 1.05 = 92.4 INR per $1
 *   → customer depositing ₹924 gets $10 (instead of $10.50 at market rate)
 */
export function computeEffectiveRate(
  baseRateInrPerUsd: number,
  markupPercent: number,
): number {
  if (markupPercent < 0 || markupPercent > 100) {
    throw new RangeError("Markup must be between 0 and 100");
  }
  if (baseRateInrPerUsd <= 0) {
    throw new RangeError("Base rate must be positive");
  }
  return baseRateInrPerUsd * (1 + markupPercent / 100);
}

/**
 * Converts INR amount to USD using the effective rate.
 * usdAmount = inrAmount / effectiveRate
 */
export function inrToUsd(inrAmount: number, effectiveRateInrPerUsd: number): number {
  if (effectiveRateInrPerUsd <= 0) {
    throw new RangeError("Effective rate must be positive");
  }
  if (inrAmount < 0) {
    throw new RangeError("INR amount must be non-negative");
  }
  return inrAmount / effectiveRateInrPerUsd;
}

/**
 * Converts USD amount to INR for display purposes.
 * Uses the effective rate (not market rate) for consistency.
 */
export function usdToInr(usdAmount: number, effectiveRateInrPerUsd: number): number {
  if (effectiveRateInrPerUsd <= 0) {
    throw new RangeError("Effective rate must be positive");
  }
  return usdAmount * effectiveRateInrPerUsd;
}

/**
 * Formats a USD amount as string with 8 decimal places (for API responses).
 */
export function formatUsd(amount: number): string {
  return amount.toFixed(8);
}

/**
 * Formats an INR amount as string with 2 decimal places (for display).
 */
export function formatInr(amount: number): string {
  return amount.toFixed(2);
}
