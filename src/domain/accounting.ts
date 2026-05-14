import { Decimal } from "decimal.js";
import { decimalToDropsFloor, dropsToDecimal, normalizeShare, normalizeShareUp } from "../lib/money.js";

export interface VaultSnapshot {
  totalShares: Decimal;
  totalAssetsDrops: bigint;
  shareIndex: Decimal;
  dustDrops: bigint;
}

export interface DepositResult {
  mintedShares: Decimal;
  next: VaultSnapshot;
}

export interface YieldResult {
  next: VaultSnapshot;
  shareIndexBefore: Decimal;
  shareIndexAfter: Decimal;
}

export interface WithdrawalQuote {
  payoutDrops: bigint;
  sharesToBurn: Decimal;
  shareIndexAtQuote: Decimal;
  fullWithdrawal: boolean;
}

export function initialVaultSnapshot(): VaultSnapshot {
  return {
    totalShares: new Decimal(0),
    totalAssetsDrops: 0n,
    shareIndex: new Decimal(1),
    dustDrops: 0n
  };
}

export function calculateShareIndex(totalAssetsDrops: bigint, totalShares: Decimal): Decimal {
  if (totalShares.lte(0)) {
    return new Decimal(1);
  }
  return dropsToDecimal(totalAssetsDrops).div(totalShares);
}

export function calculateMintedShares(amountDrops: bigint, shareIndex: Decimal): Decimal {
  if (amountDrops <= 0n) {
    throw new Error("deposit amount must be greater than zero");
  }
  if (shareIndex.lte(0)) {
    throw new Error("share index must be greater than zero");
  }
  return normalizeShare(dropsToDecimal(amountDrops).div(shareIndex));
}

export function applyDeposit(snapshot: VaultSnapshot, amountDrops: bigint): DepositResult {
  const mintedShares = calculateMintedShares(amountDrops, snapshot.shareIndex);
  const totalShares = snapshot.totalShares.plus(mintedShares);
  const totalAssetsDrops = snapshot.totalAssetsDrops + amountDrops;

  return {
    mintedShares,
    next: {
      ...snapshot,
      totalShares,
      totalAssetsDrops,
      shareIndex: calculateShareIndex(totalAssetsDrops, totalShares)
    }
  };
}

export function applyYield(snapshot: VaultSnapshot, amountDrops: bigint): YieldResult {
  if (amountDrops <= 0n) {
    throw new Error("yield amount must be greater than zero");
  }
  if (snapshot.totalShares.lte(0)) {
    throw new Error("cannot apply yield before any shares exist");
  }

  const totalAssetsDrops = snapshot.totalAssetsDrops + amountDrops;
  const shareIndexAfter = calculateShareIndex(totalAssetsDrops, snapshot.totalShares);

  return {
    shareIndexBefore: snapshot.shareIndex,
    shareIndexAfter,
    next: {
      ...snapshot,
      totalAssetsDrops,
      shareIndex: shareIndexAfter
    }
  };
}

export function quoteWithdrawal(
  availableShares: Decimal,
  shareIndex: Decimal,
  requestedDrops?: bigint
): WithdrawalQuote {
  if (availableShares.lte(0)) {
    throw new Error("no available shares to withdraw");
  }
  if (shareIndex.lte(0)) {
    throw new Error("share index must be greater than zero");
  }

  const redeemableDrops = decimalToDropsFloor(availableShares.mul(shareIndex));

  if (requestedDrops === undefined) {
    if (redeemableDrops <= 0n) {
      throw new Error("redeemable amount rounds to zero");
    }
    return {
      payoutDrops: redeemableDrops,
      sharesToBurn: normalizeShare(availableShares),
      shareIndexAtQuote: shareIndex,
      fullWithdrawal: true
    };
  }

  if (requestedDrops <= 0n) {
    throw new Error("withdrawal amount must be greater than zero");
  }
  if (requestedDrops > redeemableDrops) {
    throw new Error("withdrawal amount exceeds redeemable balance");
  }

  const sharesToBurn = normalizeShareUp(dropsToDecimal(requestedDrops).div(shareIndex));

  return {
    payoutDrops: requestedDrops,
    sharesToBurn,
    shareIndexAtQuote: shareIndex,
    fullWithdrawal: requestedDrops === redeemableDrops
  };
}

export function applyWithdrawalApproval(snapshot: VaultSnapshot, payoutDrops: bigint): VaultSnapshot {
  if (payoutDrops <= 0n) {
    throw new Error("payout amount must be greater than zero");
  }
  if (payoutDrops > snapshot.totalAssetsDrops) {
    throw new Error("payout exceeds vault assets");
  }
  const totalAssetsDrops = snapshot.totalAssetsDrops - payoutDrops;
  return {
    ...snapshot,
    totalAssetsDrops,
    shareIndex: calculateShareIndex(totalAssetsDrops, snapshot.totalShares)
  };
}
