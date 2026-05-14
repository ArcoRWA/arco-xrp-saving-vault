import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppConfig } from "../config.js";

export async function registerAuth(app: FastifyInstance, config: AppConfig) {
  app.addHook("preHandler", async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.url === "/health") {
      return;
    }

    const apiKey = request.headers["x-api-key"];
    const key = Array.isArray(apiKey) ? apiKey[0] : apiKey;
    const isAdminRoute = request.url.startsWith("/admin");
    const allowedKey = isAdminRoute ? config.adminApiKey : config.userApiKey;

    if (!key || (key !== allowedKey && key !== config.adminApiKey)) {
      await reply.code(401).send({
        error: "unauthorized",
        message: "missing or invalid x-api-key"
      });
    }
  });
}
