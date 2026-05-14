import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { parseDrops } from "../lib/money.js";
import type { VaultService } from "../services/types.js";

const yieldEventSchema = z.object({
  amountDrops: z.union([z.string(), z.number(), z.bigint()]),
  memo: z.string().optional(),
  createdBy: z.string().min(1).default("admin")
});

const assignDepositSchema = z.object({
  userId: z.string().min(1),
  actor: z.string().min(1).default("admin")
});

const resolveWithdrawalSchema = z.object({
  actor: z.string().min(1).default("admin"),
  reason: z.string().optional()
});

export async function registerAdminRoutes(app: FastifyInstance, service: VaultService) {
  app.get("/admin/vault", async () => service.getVault());

  app.post("/admin/yield-events", async (request, reply) => {
    const body = yieldEventSchema.parse(request.body ?? {});
    const vault = await service.createYieldEvent({
      amountDrops: parseDrops(body.amountDrops, "amountDrops"),
      memo: body.memo,
      createdBy: body.createdBy
    });
    return reply.code(201).send(vault);
  });

  app.get("/admin/deposits/unmatched", async () => service.listUnmatchedDeposits());

  app.post("/admin/deposits/:id/assign-user", async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = assignDepositSchema.parse(request.body ?? {});
    return service.assignDeposit({
      depositId: id,
      userId: body.userId,
      actor: body.actor
    });
  });

  app.post("/admin/withdrawals/:id/approve", async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = resolveWithdrawalSchema.parse(request.body ?? {});
    return service.approveWithdrawal({
      withdrawalId: id,
      actor: body.actor
    });
  });

  app.post("/admin/withdrawals/:id/reject", async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = resolveWithdrawalSchema.parse(request.body ?? {});
    return service.rejectWithdrawal({
      withdrawalId: id,
      actor: body.actor,
      reason: body.reason
    });
  });
}
