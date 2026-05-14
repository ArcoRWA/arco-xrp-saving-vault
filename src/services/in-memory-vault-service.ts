import { Decimal } from "decimal.js";
import {
  applyDeposit,
  applyWithdrawalApproval,
  applyYield,
  initialVaultSnapshot,
  quoteWithdrawal,
  type VaultSnapshot
} from "../domain/accounting.js";
import { generateDestinationTag } from "../lib/destination-tags.js";
import { decimalToDropsFloor } from "../lib/money.js";
import { mapBalance, mapDeposit, mapUser, mapVault, mapWithdrawal } from "./view-mappers.js";
import type {
  DepositView,
  IncomingPaymentInput,
  UserView,
  VaultService,
  VaultView,
  WithdrawalSender,
  WithdrawalView
} from "./types.js";

interface MemoryUser {
  id: string;
  externalId?: string;
  depositAddress: string;
  destinationTag: number;
  createdAt: Date;
}

interface MemoryPosition {
  userId: string;
  shares: Decimal;
  lockedShares: Decimal;
  principalDrops: bigint;
}

interface MemoryDeposit {
  id: string;
  txHash: string;
  ledgerIndex: bigint;
  senderAddress: string;
  destinationTag?: number | null;
  userId?: string | null;
  amountDrops: bigint;
  creditedShares?: Decimal | null;
  status: string;
  raw?: unknown;
  createdAt: Date;
}

interface MemoryWithdrawal {
  id: string;
  userId: string;
  destinationAddress: string;
  destinationTag?: number | null;
  requestedDrops?: bigint | null;
  payoutDrops: bigint;
  sharesBurned: Decimal;
  shareIndexAtQuote: Decimal;
  status: string;
  payoutTxHash?: string | null;
  failureReason?: string | null;
  requestedAt: Date;
  resolvedAt?: Date | null;
}

export class InMemoryVaultService implements VaultService {
  private users = new Map<string, MemoryUser>();
  private positions = new Map<string, MemoryPosition>();
  private deposits = new Map<string, MemoryDeposit>();
  private withdrawals = new Map<string, MemoryWithdrawal>();
  private snapshot: VaultSnapshot = initialVaultSnapshot();
  private nextId = 1;

  constructor(
    private readonly custodyAddress = "rTEST_CUSTODY",
    private readonly sender?: WithdrawalSender
  ) {}

  async createUser(input: { externalId?: string }): Promise<UserView> {
    const id = `user_${this.nextId++}`;
    const destinationTag = generateDestinationTag();
    const user: MemoryUser = {
      id,
      externalId: input.externalId,
      depositAddress: this.custodyAddress,
      destinationTag,
      createdAt: new Date()
    };
    this.users.set(id, user);
    this.positions.set(id, {
      userId: id,
      shares: new Decimal(0),
      lockedShares: new Decimal(0),
      principalDrops: 0n
    });
    return mapUser(user);
  }

  async getBalance(userId: string) {
    const position = this.requirePosition(userId);
    return mapBalance({
      userId,
      shares: position.shares,
      lockedShares: position.lockedShares,
      principalDrops: position.principalDrops,
      shareIndex: this.snapshot.shareIndex,
      redeemableDrops: decimalToDropsFloor(position.shares.mul(this.snapshot.shareIndex))
    });
  }

  async listDeposits(userId: string): Promise<DepositView[]> {
    return Array.from(this.deposits.values())
      .filter((deposit) => deposit.userId === userId)
      .map(mapDeposit);
  }

  async listWithdrawals(userId: string): Promise<WithdrawalView[]> {
    return Array.from(this.withdrawals.values())
      .filter((withdrawal) => withdrawal.userId === userId)
      .map(mapWithdrawal);
  }

  async requestWithdrawal(input: {
    userId: string;
    destinationAddress: string;
    destinationTag?: number;
    amountDrops?: bigint;
  }): Promise<WithdrawalView> {
    const position = this.requirePosition(input.userId);
    const quote = quoteWithdrawal(position.shares, this.snapshot.shareIndex, input.amountDrops);
    position.shares = position.shares.minus(quote.sharesToBurn);
    position.lockedShares = position.lockedShares.plus(quote.sharesToBurn);

    const withdrawal: MemoryWithdrawal = {
      id: `wd_${this.nextId++}`,
      userId: input.userId,
      destinationAddress: input.destinationAddress,
      destinationTag: input.destinationTag,
      requestedDrops: input.amountDrops ?? null,
      payoutDrops: quote.payoutDrops,
      sharesBurned: quote.sharesToBurn,
      shareIndexAtQuote: quote.shareIndexAtQuote,
      status: "PENDING",
      requestedAt: new Date()
    };
    this.withdrawals.set(withdrawal.id, withdrawal);
    return mapWithdrawal(withdrawal);
  }

  async getVault(): Promise<VaultView> {
    return mapVault({
      totalShares: this.snapshot.totalShares,
      totalAssetsDrops: this.snapshot.totalAssetsDrops,
      pendingWithdrawalDrops: Array.from(this.withdrawals.values())
        .filter((withdrawal) => withdrawal.status === "PENDING")
        .reduce((sum, withdrawal) => sum + withdrawal.payoutDrops, 0n),
      dustDrops: this.snapshot.dustDrops,
      shareIndex: this.snapshot.shareIndex
    });
  }

  async createYieldEvent(input: { amountDrops: bigint }): Promise<VaultView> {
    this.snapshot = applyYield(this.snapshot, input.amountDrops).next;
    return this.getVault();
  }

  async listUnmatchedDeposits(): Promise<DepositView[]> {
    return Array.from(this.deposits.values())
      .filter((deposit) => deposit.status === "UNMATCHED")
      .map(mapDeposit);
  }

  async assignDeposit(input: { depositId: string; userId: string }): Promise<DepositView> {
    const deposit = Array.from(this.deposits.values()).find(
      (candidate) => candidate.id === input.depositId
    );
    if (!deposit) {
      throw new Error("deposit not found");
    }
    if (deposit.status !== "UNMATCHED") {
      throw new Error("deposit is not unmatched");
    }
    this.requirePosition(input.userId);
    const credited = this.creditDeposit(deposit.amountDrops, input.userId);
    deposit.userId = input.userId;
    deposit.status = "CREDITED";
    deposit.creditedShares = credited;
    return mapDeposit(deposit);
  }

  async approveWithdrawal(input: { withdrawalId: string }): Promise<WithdrawalView> {
    const withdrawal = this.requireWithdrawal(input.withdrawalId);
    if (withdrawal.status !== "PENDING") {
      throw new Error("withdrawal is not pending");
    }
    const result = this.sender
      ? await this.sender.sendPayment({
          destinationAddress: withdrawal.destinationAddress,
          destinationTag: withdrawal.destinationTag ?? undefined,
          amountDrops: withdrawal.payoutDrops
        })
      : { txHash: `testnet_tx_${withdrawal.id}` };

    const position = this.requirePosition(withdrawal.userId);
    position.lockedShares = position.lockedShares.minus(withdrawal.sharesBurned);
    this.snapshot.totalShares = this.snapshot.totalShares.minus(withdrawal.sharesBurned);
    this.snapshot = applyWithdrawalApproval(this.snapshot, withdrawal.payoutDrops);
    withdrawal.status = "APPROVED";
    withdrawal.payoutTxHash = result.txHash;
    withdrawal.resolvedAt = new Date();
    return mapWithdrawal(withdrawal);
  }

  async rejectWithdrawal(input: { withdrawalId: string; reason?: string }): Promise<WithdrawalView> {
    const withdrawal = this.requireWithdrawal(input.withdrawalId);
    if (withdrawal.status !== "PENDING") {
      throw new Error("withdrawal is not pending");
    }
    const position = this.requirePosition(withdrawal.userId);
    position.shares = position.shares.plus(withdrawal.sharesBurned);
    position.lockedShares = position.lockedShares.minus(withdrawal.sharesBurned);
    withdrawal.status = "REJECTED";
    withdrawal.failureReason = input.reason ?? null;
    withdrawal.resolvedAt = new Date();
    return mapWithdrawal(withdrawal);
  }

  async recordIncomingPayment(input: IncomingPaymentInput): Promise<DepositView> {
    const existing = this.deposits.get(input.txHash);
    if (existing) {
      return mapDeposit(existing);
    }

    const user = Array.from(this.users.values()).find(
      (candidate) => candidate.destinationTag === input.destinationTag
    );
    const creditedShares = user ? this.creditDeposit(input.amountDrops, user.id) : null;
    const deposit: MemoryDeposit = {
      id: `dep_${this.nextId++}`,
      txHash: input.txHash,
      ledgerIndex: input.ledgerIndex,
      senderAddress: input.senderAddress,
      destinationTag: input.destinationTag ?? null,
      userId: user?.id ?? null,
      amountDrops: input.amountDrops,
      creditedShares,
      status: user ? "CREDITED" : "UNMATCHED",
      raw: input.raw,
      createdAt: new Date()
    };
    this.deposits.set(input.txHash, deposit);
    return mapDeposit(deposit);
  }

  private creditDeposit(amountDrops: bigint, userId: string): Decimal {
    const position = this.requirePosition(userId);
    const result = applyDeposit(this.snapshot, amountDrops);
    this.snapshot = result.next;
    position.shares = position.shares.plus(result.mintedShares);
    position.principalDrops += amountDrops;
    return result.mintedShares;
  }

  private requirePosition(userId: string): MemoryPosition {
    const position = this.positions.get(userId);
    if (!position) {
      throw new Error("user not found");
    }
    return position;
  }

  private requireWithdrawal(withdrawalId: string): MemoryWithdrawal {
    const withdrawal = this.withdrawals.get(withdrawalId);
    if (!withdrawal) {
      throw new Error("withdrawal not found");
    }
    return withdrawal;
  }
}
