import { randomInt } from "node:crypto";

const MIN_TAG = 1;
const MAX_TAG = 4_294_967_295;

export function generateDestinationTag(): number {
  return randomInt(MIN_TAG, MAX_TAG);
}
