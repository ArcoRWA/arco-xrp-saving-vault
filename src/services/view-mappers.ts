import type {
  BalanceView,
  DepositView,
  UserView,
  VaultView,
  WithdrawalView
} from "./types.js";

export function toIso(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : value;
}

export function mapUser(user: {
  id: string;
  externalId?: string | null;
  depositAddress: string;
  destinationTag: number;
  createdAt: Date | string;
}): UserView {
  return {
    id: user.id,
    externalId: user.externalId ?? null,
    depositAddress: user.depositAddress,
    destinationTag: user.destinationTag,
    createdAt: toIso(user.createdAt) ?? new Date().toISOString()
  };
}

export function mapVault(state: {
  totalShares: { toString(): string };
  totalAssetsDrops: bigint | number | string;
  pendingWithdrawalDrops: bigint | number | string;
  dustDrops: bigint | number | string;
  currentShareIndex?: { toString(): string };
  shareIndex?: { toString(): string };
}): VaultView {
  return {
    totalShares: state.totalShares.toString(),
    totalAssetsDrops: state.totalAssetsDrops.toString(),
    pendingWithdrawalDrops: state.pendingWithdrawalDrops.toString(),
    dustDrops: state.dustDrops.toString(),
    shareIndex: (state.currentShareIndex ?? state.shareIndex)?.toString() ?? "1"
  };
}

export function mapBalance(input: {
  userId: string;
  shares: { toString(): string };
  lockedShares: { toString(): string };
  principalDrops: bigint | number | string;
  shareIndex: { toString(): string };
  redeemableDrops: bigint | number | string;
}): BalanceView {
  return {
    userId: input.userId,
    shares: input.shares.toString(),
    lockedShares: input.lockedShares.toString(),
    principalDrops: input.principalDrops.toString(),
    shareIndex: input.shareIndex.toString(),
    redeemableDrops: input.redeemableDrops.toString()
  };
}

export function mapDeposit(deposit: {
  id: string;
  txHash: string;
  ledgerIndex: bigint | number | string;
  senderAddress: string;
  destinationTag?: number | null;
  userId?: string | null;
  amountDrops: bigint | number | string;
  creditedShares?: { toString(): string } | null;
  status: string;
  createdAt: Date | string;
}): DepositView {
  return {
    id: deposit.id,
    txHash: deposit.txHash,
    ledgerIndex: deposit.ledgerIndex.toString(),
    senderAddress: deposit.senderAddress,
    destinationTag: deposit.destinationTag ?? null,
    userId: deposit.userId ?? null,
    amountDrops: deposit.amountDrops.toString(),
    creditedShares: deposit.creditedShares?.toString() ?? null,
    status: deposit.status,
    createdAt: toIso(deposit.createdAt) ?? new Date().toISOString()
  };
}

export function mapWithdrawal(withdrawal: {
  id: string;
  userId: string;
  destinationAddress: string;
  destinationTag?: number | null;
  requestedDrops?: bigint | number | string | null;
  payoutDrops: bigint | number | string;
  sharesBurned: { toString(): string };
  shareIndexAtQuote: { toString(): string };
  status: string;
  payoutTxHash?: string | null;
  failureReason?: string | null;
  requestedAt: Date | string;
  resolvedAt?: Date | string | null;
}): WithdrawalView {
  return {
    id: withdrawal.id,
    userId: withdrawal.userId,
    destinationAddress: withdrawal.destinationAddress,
    destinationTag: withdrawal.destinationTag ?? null,
    requestedDrops: withdrawal.requestedDrops?.toString() ?? null,
    payoutDrops: withdrawal.payoutDrops.toString(),
    sharesBurned: withdrawal.sharesBurned.toString(),
    shareIndexAtQuote: withdrawal.shareIndexAtQuote.toString(),
    status: withdrawal.status,
    payoutTxHash: withdrawal.payoutTxHash ?? null,
    failureReason: withdrawal.failureReason ?? null,
    requestedAt: toIso(withdrawal.requestedAt) ?? new Date().toISOString(),
    resolvedAt: toIso(withdrawal.resolvedAt) ?? null
  };
}
