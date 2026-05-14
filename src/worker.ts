import { PrismaClient } from "@prisma/client";
import { loadConfig } from "./config.js";
import { PrismaVaultService } from "./services/prisma-vault-service.js";
import { XrplWithdrawalSender } from "./services/xrpl-withdrawal-sender.js";
import { runDepositWorker } from "./workers/deposit-worker.js";

const config = loadConfig();
const prisma = new PrismaClient();
const sender = config.custodySeed
  ? new XrplWithdrawalSender(config.xrplNetwork, config.custodySeed)
  : undefined;
const service = new PrismaVaultService(prisma, config.custodyAddress, sender);

await runDepositWorker(prisma, service, {
  xrplNetwork: config.xrplNetwork,
  custodyAddress: config.custodyAddress
});
