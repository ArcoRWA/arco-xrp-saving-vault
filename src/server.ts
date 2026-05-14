import { PrismaClient } from "@prisma/client";
import { loadConfig } from "./config.js";
import { buildApp } from "./app.js";
import { PrismaVaultService } from "./services/prisma-vault-service.js";
import { XrplWithdrawalSender } from "./services/xrpl-withdrawal-sender.js";

const config = loadConfig();
const prisma = new PrismaClient();
const sender = config.custodySeed
  ? new XrplWithdrawalSender(config.xrplNetwork, config.custodySeed)
  : undefined;
const service = new PrismaVaultService(prisma, config.custodyAddress, sender);
const app = await buildApp(config, service);

try {
  await app.listen({ host: "0.0.0.0", port: config.port });
} catch (error) {
  app.log.error(error);
  await prisma.$disconnect();
  process.exit(1);
}
