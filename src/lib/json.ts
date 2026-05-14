import { Decimal } from "decimal.js";

export function toJsonSafe<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, current) => {
      if (typeof current === "bigint") {
        return current.toString();
      }
      if (current instanceof Decimal) {
        return current.toString();
      }
      return current;
    })
  ) as T;
}
