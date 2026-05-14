import sensible from "@fastify/sensible";
import Fastify from "fastify";
import type { AppConfig } from "./config.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerAuth } from "./routes/auth.js";
import { registerUserRoutes } from "./routes/users.js";
import type { VaultService } from "./services/types.js";

export async function buildApp(config: AppConfig, service: VaultService) {
  const app = Fastify({
    logger: config.nodeEnv !== "test"
  });

  await app.register(sensible);
  await registerAuth(app, config);

  app.get("/health", async () => ({ ok: true, service: "arco-xrp-saving-vault" }));

  await registerUserRoutes(app, service);
  await registerAdminRoutes(app, service);

  app.setErrorHandler((error: Error & { statusCode?: number }, _request, reply) => {
    const statusCode = error.statusCode ?? 400;
    reply.code(statusCode).send({
      error: error.name,
      message: error.message
    });
  });

  return app;
}
