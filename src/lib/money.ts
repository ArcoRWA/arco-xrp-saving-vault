import { Decimal } from "decimal.js";

export const DROPS_PER_XRP = 1_000_000n;
export const DECIMAL_PLACES = 18;

Decimal.set({
  precision: 60,
  rounding: Decimal.ROUND_DOWN
});

export function dropsToDecimal(drops: bigint | number | string): Decimal {
  return new Decimal(drops.toString());
}

export function decimalToDropsFloor(value: Decimal): bigint {
  if (value.isNegative()) {
    throw new Error("drops cannot be negative");
  }
  return BigInt(value.floor().toFixed(0));
}

export function decimalToDropsCeil(value: Decimal): bigint {
  if (value.isNegative()) {
    throw new Error("drops cannot be negative");
  }
  return BigInt(value.ceil().toFixed(0));
}

export function normalizeShare(value: Decimal): Decimal {
  return new Decimal(value.toFixed(DECIMAL_PLACES, Decimal.ROUND_DOWN));
}

export function normalizeShareUp(value: Decimal): Decimal {
  return new Decimal(value.toFixed(DECIMAL_PLACES, Decimal.ROUND_UP));
}

export function parseDrops(value: unknown, field = "drops"): bigint {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") {
    throw new Error(`${field} must be an integer drop amount`);
  }

  const text = value.toString();
  if (!/^\d+$/.test(text)) {
    throw new Error(`${field} must be an integer drop amount`);
  }

  const drops = BigInt(text);
  if (drops <= 0n) {
    throw new Error(`${field} must be greater than zero`);
  }
  return drops;
}

export function serializeDecimal(value: Decimal | { toString(): string }): string {
  return value.toString();
}

export function serializeDrops(value: bigint | number | string): string {
  return value.toString();
}
