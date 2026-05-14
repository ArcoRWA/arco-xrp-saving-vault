import { classicAddressToXAddress } from "xrpl";

export function maybeBuildXAddress(
  classicAddress: string,
  destinationTag: number,
  testnet = true
): string | null {
  try {
    return classicAddressToXAddress(classicAddress, destinationTag, testnet);
  } catch {
    return null;
  }
}
