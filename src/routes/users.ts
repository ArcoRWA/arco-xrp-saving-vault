import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { parseDrops } from "../lib/money.js";
import { maybeBuildXAddress } from "../services/x-address.js";
import type { VaultService } from "../services/types.js";

const createUserSchema = z.object({
  externalId: z.string().min(1).optional()
});

const withdrawalSchema = z.object({
  userId: z.string().min(1),
  destinationAddress: z.string().min(25),
  destinationTag: z.number().int().min(0).optional(),
  amountDrops: z.union([z.string(), z.number(), z.bigint()]).optional()
});

export async function registerUserRoutes(app: FastifyInstance, service: VaultService) {
  app.post("/users", async (request, reply) => {
    const body = createUserSchema.parse(request.body ?? {});
    const user = await service.createUser(body);
    return reply.code(201).send({
      ...user,
      xAddress: maybeBuildXAddress(user.depositAddress, user.destinationTag)
    });
  });

  app.get("/users/:id/balance", async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    return service.getBalance(id);
  });

  app.get("/users/:id/deposits", async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    return service.listDeposits(id);
  });

  app.get("/users/:id/withdrawals", async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    return service.listWithdrawals(id);
  });

  app.post("/withdrawals", async (request, reply) => {
    const body = withdrawalSchema.parse(request.body ?? {});
    const withdrawal = await service.requestWithdrawal({
      userId: body.userId,
      destinationAddress: body.destinationAddress,
      destinationTag: body.destinationTag,
      amountDrops: body.amountDrops === undefined ? undefined : parseDrops(body.amountDrops, "amountDrops")
    });
    return reply.code(201).send(withdrawal);
  });
}
