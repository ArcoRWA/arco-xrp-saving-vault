export interface UserView {
  id: string;
  externalId?: string | null;
  depositAddress: string;
  destinationTag: number;
  createdAt: string;
}

export interface BalanceView {
  userId: string;
  shares: string;
  lockedShares: string;
  principalDrops: string;
  shareIndex: string;
  redeemableDrops: string;
}

export interface DepositView {
  id: string;
  txHash: string;
  ledgerIndex: string;
  senderAddress: string;
  destinationTag?: number | null;
  userId?: string | null;
  amountDrops: string;
  creditedShares?: string | null;
  status: string;
  createdAt: string;
}

export interface WithdrawalView {
  id: string;
  userId: string;
  destinationAddress: string;
  destinationTag?: number | null;
  requestedDrops?: string | null;
  payoutDrops: string;
  sharesBurned: string;
  shareIndexAtQuote: string;
  status: string;
  payoutTxHash?: string | null;
  failureReason?: string | null;
  requestedAt: string;
  resolvedAt?: string | null;
}

export interface VaultView {
  totalShares: string;
  totalAssetsDrops: string;
  pendingWithdrawalDrops: string;
  dustDrops: string;
  shareIndex: string;
}

export interface IncomingPaymentInput {
  txHash: string;
  ledgerIndex: bigint;
  senderAddress: string;
  destinationTag?: number;
  amountDrops: bigint;
  raw?: unknown;
}

export interface WithdrawalSender {
  sendPayment(input: {
    destinationAddress: string;
    destinationTag?: number;
    amountDrops: bigint;
  }): Promise<{ txHash: string }>;
}

export interface VaultService {
  createUser(input: { externalId?: string }): Promise<UserView>;
  getBalance(userId: string): Promise<BalanceView>;
  listDeposits(userId: string): Promise<DepositView[]>;
  listWithdrawals(userId: string): Promise<WithdrawalView[]>;
  requestWithdrawal(input: {
    userId: string;
    destinationAddress: string;
    destinationTag?: number;
    amountDrops?: bigint;
  }): Promise<WithdrawalView>;
  getVault(): Promise<VaultView>;
  createYieldEvent(input: { amountDrops: bigint; memo?: string; createdBy: string }): Promise<VaultView>;
  listUnmatchedDeposits(): Promise<DepositView[]>;
  assignDeposit(input: { depositId: string; userId: string; actor: string }): Promise<DepositView>;
  approveWithdrawal(input: { withdrawalId: string; actor: string }): Promise<WithdrawalView>;
  rejectWithdrawal(input: { withdrawalId: string; actor: string; reason?: string }): Promise<WithdrawalView>;
  recordIncomingPayment(input: IncomingPaymentInput): Promise<DepositView>;
}
