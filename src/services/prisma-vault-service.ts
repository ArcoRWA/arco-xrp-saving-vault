import { Prisma, PrismaClient } from "@prisma/client";
import { Decimal } from "decimal.js";
import {
  applyDeposit,
  applyYield,
  calculateShareIndex,
  quoteWithdrawal
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

const DEFAULT_STATE_ID = "default";

export class PrismaVaultService implements VaultService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly custodyAddress: string,
    private readonly sender?: WithdrawalSender
  ) {}

  async createUser(input: { externalId?: string }): Promise<UserView> {
    await this.ensureVaultState();

    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        const user = await this.prisma.user.create({
          data: {
            externalId: input.externalId,
            depositAddress: this.custodyAddress,
            destinationTag: generateDestinationTag(),
            position: {
              create: {}
            }
          }
        });
        return mapUser(user);
      } catch (error) {
        if (this.isUniqueConstraint(error)) {
          continue;
        }
        throw error;
      }
    }

    throw new Error("failed to allocate unique destination tag");
  }

  async getBalance(userId: string) {
    const [state, position] = await Promise.all([
      this.ensureVaultState(),
      this.prisma.vaultPosition.findUnique({ where: { userId } })
    ]);
    if (!position) {
      throw new Error("user not found");
    }

    const shareIndex = new Decimal(state.currentShareIndex.toString());
    return mapBalance({
      userId,
      shares: position.shares,
      lockedShares: position.lockedShares,
      principalDrops: position.principalDrops,
      shareIndex,
      redeemableDrops: decimalToDropsFloor(new Decimal(position.shares.toString()).mul(shareIndex))
    });
  }

  async listDeposits(userId: string): Promise<DepositView[]> {
    const deposits = await this.prisma.deposit.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" }
    });
    return deposits.map(mapDeposit);
  }

  async listWithdrawals(userId: string): Promise<WithdrawalView[]> {
    const withdrawals = await this.prisma.withdrawal.findMany({
      where: { userId },
      orderBy: { requestedAt: "desc" }
    });
    return withdrawals.map(mapWithdrawal);
  }

  async requestWithdrawal(input: {
    userId: string;
    destinationAddress: string;
    destinationTag?: number;
    amountDrops?: bigint;
  }): Promise<WithdrawalView> {
    const withdrawal = await this.prisma.$transaction(async (tx) => {
      const [state, position] = await Promise.all([
        this.ensureVaultState(tx),
        tx.vaultPosition.findUnique({ where: { userId: input.userId } })
      ]);
      if (!position) {
        throw new Error("user not found");
      }

      const quote = quoteWithdrawal(
        new Decimal(position.shares.toString()),
        new Decimal(state.currentShareIndex.toString()),
        input.amountDrops
      );

      const created = await tx.withdrawal.create({
        data: {
          userId: input.userId,
          destinationAddress: input.destinationAddress,
          destinationTag: input.destinationTag,
          requestedDrops: input.amountDrops,
          payoutDrops: quote.payoutDrops,
          sharesBurned: quote.sharesToBurn.toString(),
          shareIndexAtQuote: quote.shareIndexAtQuote.toString()
        }
      });

      await tx.vaultPosition.update({
        where: { userId: input.userId },
        data: {
          shares: { decrement: quote.sharesToBurn.toString() },
          lockedShares: { increment: quote.sharesToBurn.toString() }
        }
      });

      await tx.vaultState.update({
        where: { id: DEFAULT_STATE_ID },
        data: {
          pendingWithdrawalDrops: { increment: quote.payoutDrops }
        }
      });

      await tx.ledgerEntry.create({
        data: {
          type: "WITHDRAWAL_REQUEST",
          userId: input.userId,
          amountDrops: quote.payoutDrops,
          sharesDelta: quote.sharesToBurn.negated().toString(),
          shareIndex: quote.shareIndexAtQuote.toString(),
          referenceType: "Withdrawal",
          referenceId: created.id
        }
      });

      return created;
    });

    return mapWithdrawal(withdrawal);
  }

  async getVault(): Promise<VaultView> {
    return mapVault(await this.ensureVaultState());
  }

  async createYieldEvent(input: {
    amountDrops: bigint;
    memo?: string;
    createdBy: string;
  }): Promise<VaultView> {
    const state = await this.prisma.$transaction(async (tx) => {
      const current = await this.ensureVaultState(tx);
      const result = applyYield(
        {
          totalShares: new Decimal(current.totalShares.toString()),
          totalAssetsDrops: current.totalAssetsDrops,
          shareIndex: new Decimal(current.currentShareIndex.toString()),
          dustDrops: current.dustDrops
        },
        input.amountDrops
      );

      const updated = await tx.vaultState.update({
        where: { id: DEFAULT_STATE_ID },
        data: {
          totalAssetsDrops: result.next.totalAssetsDrops,
          currentShareIndex: result.shareIndexAfter.toString()
        }
      });

      const yieldEvent = await tx.yieldEvent.create({
        data: {
          amountDrops: input.amountDrops,
          shareIndexBefore: result.shareIndexBefore.toString(),
          shareIndexAfter: result.shareIndexAfter.toString(),
          memo: input.memo,
          createdBy: input.createdBy
        }
      });

      await tx.ledgerEntry.create({
        data: {
          type: "YIELD",
          amountDrops: input.amountDrops,
          sharesDelta: "0",
          shareIndex: result.shareIndexAfter.toString(),
          referenceType: "YieldEvent",
          referenceId: yieldEvent.id
        }
      });

      return updated;
    });

    return mapVault(state);
  }

  async listUnmatchedDeposits(): Promise<DepositView[]> {
    const deposits = await this.prisma.deposit.findMany({
      where: { status: "UNMATCHED" },
      orderBy: { createdAt: "desc" }
    });
    return deposits.map(mapDeposit);
  }

  async assignDeposit(input: { depositId: string; userId: string; actor: string }): Promise<DepositView> {
    const deposit = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.deposit.findUnique({ where: { id: input.depositId } });
      if (!existing) {
        throw new Error("deposit not found");
      }
      if (existing.status !== "UNMATCHED") {
        throw new Error("deposit is not unmatched");
      }

      const updated = await this.creditDepositTx(tx, {
        amountDrops: existing.amountDrops,
        userId: input.userId,
        referenceType: "Deposit",
        referenceId: existing.id,
        ledgerType: "MANUAL_ASSIGNMENT"
      });

      const assigned = await tx.deposit.update({
        where: { id: input.depositId },
        data: {
          userId: input.userId,
          status: "CREDITED",
          creditedShares: updated.mintedShares.toString()
        }
      });

      await tx.auditLog.create({
        data: {
          actor: input.actor,
          action: "deposit.assign_user",
          targetType: "Deposit",
          targetId: input.depositId,
          metadata: { userId: input.userId }
        }
      });

      return assigned;
    });

    return mapDeposit(deposit);
  }

  async approveWithdrawal(input: { withdrawalId: string; actor: string }): Promise<WithdrawalView> {
    const withdrawal = await this.prisma.withdrawal.findUnique({
      where: { id: input.withdrawalId }
    });
    if (!withdrawal) {
      throw new Error("withdrawal not found");
    }
    if (withdrawal.status !== "PENDING") {
      throw new Error("withdrawal is not pending");
    }
    if (!this.sender) {
      throw new Error("withdrawal sender is not configured");
    }

    try {
      const payment = await this.sender.sendPayment({
        destinationAddress: withdrawal.destinationAddress,
        destinationTag: withdrawal.destinationTag ?? undefined,
        amountDrops: withdrawal.payoutDrops
      });
      const approved = await this.markWithdrawalApproved(input.withdrawalId, input.actor, payment.txHash);
      return mapWithdrawal(approved);
    } catch (error) {
      const failed = await this.markWithdrawalFailed(input.withdrawalId, error);
      return mapWithdrawal(failed);
    }
  }

  async rejectWithdrawal(input: {
    withdrawalId: string;
    actor: string;
    reason?: string;
  }): Promise<WithdrawalView> {
    const rejected = await this.prisma.$transaction(async (tx) => {
      const withdrawal = await tx.withdrawal.findUnique({ where: { id: input.withdrawalId } });
      if (!withdrawal) {
        throw new Error("withdrawal not found");
      }
      if (withdrawal.status !== "PENDING") {
        throw new Error("withdrawal is not pending");
      }

      await this.releaseWithdrawalLock(tx, withdrawal);
      const updated = await tx.withdrawal.update({
        where: { id: input.withdrawalId },
        data: {
          status: "REJECTED",
          failureReason: input.reason,
          resolvedAt: new Date()
        }
      });

      await tx.auditLog.create({
        data: {
          actor: input.actor,
          action: "withdrawal.reject",
          targetType: "Withdrawal",
          targetId: input.withdrawalId,
          metadata: { reason: input.reason }
        }
      });

      await tx.ledgerEntry.create({
        data: {
          type: "WITHDRAWAL_REJECTION",
          userId: withdrawal.userId,
          amountDrops: withdrawal.payoutDrops,
          sharesDelta: withdrawal.sharesBurned.toString(),
          shareIndex: withdrawal.shareIndexAtQuote.toString(),
          referenceType: "Withdrawal",
          referenceId: withdrawal.id
        }
      });

      return updated;
    });

    return mapWithdrawal(rejected);
  }

  async recordIncomingPayment(input: IncomingPaymentInput): Promise<DepositView> {
    const deposit = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.deposit.findUnique({ where: { txHash: input.txHash } });
      if (existing) {
        return existing;
      }

      const user = input.destinationTag
        ? await tx.user.findUnique({ where: { destinationTag: input.destinationTag } })
        : null;

      if (!user) {
        return tx.deposit.create({
          data: {
            txHash: input.txHash,
            ledgerIndex: input.ledgerIndex,
            senderAddress: input.senderAddress,
            destinationTag: input.destinationTag,
            amountDrops: input.amountDrops,
            status: "UNMATCHED",
            raw: input.raw as Prisma.InputJsonValue
          }
        });
      }

      const credit = await this.creditDepositTx(tx, {
        amountDrops: input.amountDrops,
        userId: user.id,
        referenceType: "Deposit",
        referenceId: input.txHash,
        ledgerType: "DEPOSIT"
      });

      return tx.deposit.create({
        data: {
          txHash: input.txHash,
          ledgerIndex: input.ledgerIndex,
          senderAddress: input.senderAddress,
          destinationTag: input.destinationTag,
          userId: user.id,
          amountDrops: input.amountDrops,
          creditedShares: credit.mintedShares.toString(),
          status: "CREDITED",
          raw: input.raw as Prisma.InputJsonValue
        }
      });
    });

    return mapDeposit(deposit);
  }

  private async markWithdrawalApproved(withdrawalId: string, actor: string, txHash: string) {
    return this.prisma.$transaction(async (tx) => {
      const withdrawal = await tx.withdrawal.findUnique({ where: { id: withdrawalId } });
      if (!withdrawal) {
        throw new Error("withdrawal not found");
      }
      if (withdrawal.status !== "PENDING") {
        throw new Error("withdrawal is not pending");
      }

      const state = await this.ensureVaultState(tx);
      const nextTotalShares = new Decimal(state.totalShares.toString()).minus(
        withdrawal.sharesBurned.toString()
      );
      const nextTotalAssets = state.totalAssetsDrops - withdrawal.payoutDrops;
      const nextShareIndex = calculateShareIndex(nextTotalAssets, nextTotalShares);

      await tx.vaultPosition.update({
        where: { userId: withdrawal.userId },
        data: {
          lockedShares: { decrement: withdrawal.sharesBurned.toString() }
        }
      });

      await tx.vaultState.update({
        where: { id: DEFAULT_STATE_ID },
        data: {
          totalShares: nextTotalShares.toString(),
          totalAssetsDrops: nextTotalAssets,
          pendingWithdrawalDrops: { decrement: withdrawal.payoutDrops },
          currentShareIndex: nextShareIndex.toString()
        }
      });

      const updated = await tx.withdrawal.update({
        where: { id: withdrawalId },
        data: {
          status: "APPROVED",
          payoutTxHash: txHash,
          resolvedAt: new Date()
        }
      });

      await tx.auditLog.create({
        data: {
          actor,
          action: "withdrawal.approve",
          targetType: "Withdrawal",
          targetId: withdrawalId,
          metadata: { payoutTxHash: txHash }
        }
      });

      await tx.ledgerEntry.create({
        data: {
          type: "WITHDRAWAL_APPROVAL",
          userId: withdrawal.userId,
          amountDrops: withdrawal.payoutDrops,
          sharesDelta: withdrawal.sharesBurned.negated().toString(),
          shareIndex: nextShareIndex.toString(),
          referenceType: "Withdrawal",
          referenceId: withdrawal.id
        }
      });

      return updated;
    });
  }

  private async markWithdrawalFailed(withdrawalId: string, error: unknown) {
    return this.prisma.$transaction(async (tx) => {
      const withdrawal = await tx.withdrawal.findUnique({ where: { id: withdrawalId } });
      if (!withdrawal) {
        throw new Error("withdrawal not found");
      }
      if (withdrawal.status !== "PENDING") {
        throw new Error("withdrawal is not pending");
      }
      await this.releaseWithdrawalLock(tx, withdrawal);
      return tx.withdrawal.update({
        where: { id: withdrawalId },
        data: {
          status: "FAILED",
          failureReason: error instanceof Error ? error.message : String(error),
          resolvedAt: new Date()
        }
      });
    });
  }

  private async releaseWithdrawalLock(
    tx: Prisma.TransactionClient,
    withdrawal: {
      userId: string;
      payoutDrops: bigint;
      sharesBurned: Prisma.Decimal;
    }
  ) {
    await tx.vaultPosition.update({
      where: { userId: withdrawal.userId },
      data: {
        shares: { increment: withdrawal.sharesBurned.toString() },
        lockedShares: { decrement: withdrawal.sharesBurned.toString() }
      }
    });
    await tx.vaultState.update({
      where: { id: DEFAULT_STATE_ID },
      data: {
        pendingWithdrawalDrops: { decrement: withdrawal.payoutDrops }
      }
    });
  }

  private async creditDepositTx(
    tx: Prisma.TransactionClient,
    input: {
      amountDrops: bigint;
      userId: string;
      referenceType: string;
      referenceId: string;
      ledgerType: "DEPOSIT" | "MANUAL_ASSIGNMENT";
    }
  ) {
    const state = await this.ensureVaultState(tx);
    const result = applyDeposit(
      {
        totalShares: new Decimal(state.totalShares.toString()),
        totalAssetsDrops: state.totalAssetsDrops,
        shareIndex: new Decimal(state.currentShareIndex.toString()),
        dustDrops: state.dustDrops
      },
      input.amountDrops
    );

    await tx.vaultState.update({
      where: { id: DEFAULT_STATE_ID },
      data: {
        totalShares: result.next.totalShares.toString(),
        totalAssetsDrops: result.next.totalAssetsDrops,
        currentShareIndex: result.next.shareIndex.toString()
      }
    });

    await tx.vaultPosition.update({
      where: { userId: input.userId },
      data: {
        shares: { increment: result.mintedShares.toString() },
        principalDrops: { increment: input.amountDrops }
      }
    });

    await tx.ledgerEntry.create({
      data: {
        type: input.ledgerType,
        userId: input.userId,
        amountDrops: input.amountDrops,
        sharesDelta: result.mintedShares.toString(),
        shareIndex: result.next.shareIndex.toString(),
        referenceType: input.referenceType,
        referenceId: input.referenceId
      }
    });

    return result;
  }

  private async ensureVaultState(tx: Prisma.TransactionClient | PrismaClient = this.prisma) {
    return tx.vaultState.upsert({
      where: { id: DEFAULT_STATE_ID },
      create: { id: DEFAULT_STATE_ID },
      update: {}
    });
  }

  private isUniqueConstraint(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
  }
}
