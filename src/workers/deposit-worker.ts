import { PrismaClient } from "@prisma/client";
import { Client } from "xrpl";
import { parseIncomingXrpPayment } from "../domain/xrpl-events.js";
import type { PrismaVaultService } from "../services/prisma-vault-service.js";

export interface DepositWorkerConfig {
  xrplNetwork: string;
  custodyAddress: string;
}

export async function backfillDeposits(
  client: Client,
  prisma: PrismaClient,
  service: PrismaVaultService,
  config: DepositWorkerConfig
) {
  const cursor = await prisma.chainCursor.findUnique({
    where: { account: config.custodyAddress }
  });
  const ledgerIndexMin = cursor ? Number(cursor.lastLedgerIndex + 1n) : -1;

  let marker: unknown;
  let lastLedgerIndex = cursor?.lastLedgerIndex ?? 0n;

  do {
    const response = await client.request({
      command: "account_tx",
      account: config.custodyAddress,
      ledger_index_min: ledgerIndexMin,
      ledger_index_max: -1,
      limit: 200,
      marker
    });

    const transactions = response.result.transactions ?? [];
    for (const wrapped of transactions) {
      const event = wrapped as unknown as Record<string, unknown>;
      const payment = parseIncomingXrpPayment(event, config.custodyAddress);
      if (payment) {
        await service.recordIncomingPayment(payment);
        if (payment.ledgerIndex > lastLedgerIndex) {
          lastLedgerIndex = payment.ledgerIndex;
        }
      }
    }

    marker = response.result.marker;
  } while (marker);

  if (lastLedgerIndex > 0n) {
    await prisma.chainCursor.upsert({
      where: { account: config.custodyAddress },
      create: {
        account: config.custodyAddress,
        lastLedgerIndex
      },
      update: {
        lastLedgerIndex
      }
    });
  }
}

export async function runDepositWorker(
  prisma: PrismaClient,
  service: PrismaVaultService,
  config: DepositWorkerConfig
) {
  const client = new Client(config.xrplNetwork);
  await client.connect();

  await backfillDeposits(client, prisma, service, config);

  await client.request({
    command: "subscribe",
    accounts: [config.custodyAddress]
  });

  client.on("transaction", async (event) => {
    try {
      const payment = parseIncomingXrpPayment(event as unknown as Record<string, unknown>, config.custodyAddress);
      if (!payment) {
        return;
      }
      await service.recordIncomingPayment(payment);
      await prisma.chainCursor.upsert({
        where: { account: config.custodyAddress },
        create: {
          account: config.custodyAddress,
          lastLedgerIndex: payment.ledgerIndex
        },
        update: {
          lastLedgerIndex: payment.ledgerIndex
        }
      });
    } catch (error) {
      console.error("deposit worker failed to process transaction", error);
    }
  });

  const shutdown = async () => {
    await client.disconnect();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
