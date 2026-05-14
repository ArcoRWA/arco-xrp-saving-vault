import type { AppConfig } from "../src/config.js";
import { buildApp } from "../src/app.js";
import { InMemoryVaultService } from "../src/services/in-memory-vault-service.js";

const config: AppConfig = {
  nodeEnv: "test",
  port: 0,
  databaseUrl: "postgresql://unused",
  xrplNetwork: "wss://s.altnet.rippletest.net:51233",
  custodyAddress: "rTEST_CUSTODY_ADDRESS_123456",
  requireDestinationTag: true,
  userApiKey: "user-key",
  adminApiKey: "admin-key"
};

describe("API", () => {
  it("requires API keys outside health", async () => {
    const app = await buildApp(config, new InMemoryVaultService(config.custodyAddress));
    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);

    const rejected = await app.inject({ method: "POST", url: "/users", payload: {} });
    expect(rejected.statusCode).toBe(401);
    await app.close();
  });

  it("creates users, credits deposits, applies yield, and approves withdrawal", async () => {
    const service = new InMemoryVaultService(config.custodyAddress);
    const app = await buildApp(config, service);

    const created = await app.inject({
      method: "POST",
      url: "/users",
      headers: { "x-api-key": config.userApiKey },
      payload: { externalId: "demo-user" }
    });
    expect(created.statusCode).toBe(201);
    const user = created.json();

    await service.recordIncomingPayment({
      txHash: "DEPOSIT_1",
      ledgerIndex: 1n,
      senderAddress: "rSENDER",
      destinationTag: user.destinationTag,
      amountDrops: 100_000_000n
    });

    const yieldEvent = await app.inject({
      method: "POST",
      url: "/admin/yield-events",
      headers: { "x-api-key": config.adminApiKey },
      payload: { amountDrops: "10", memo: "test yield" }
    });
    expect(yieldEvent.statusCode).toBe(201);

    const balance = await app.inject({
      method: "GET",
      url: `/users/${user.id}/balance`,
      headers: { "x-api-key": config.userApiKey }
    });
    expect(balance.json().redeemableDrops).toBe("100000010");

    const requested = await app.inject({
      method: "POST",
      url: "/withdrawals",
      headers: { "x-api-key": config.userApiKey },
      payload: {
        userId: user.id,
        destinationAddress: "rDESTINATION_ADDRESS_123456789",
        amountDrops: "50000000"
      }
    });
    expect(requested.statusCode).toBe(201);
    const withdrawal = requested.json();
    expect(withdrawal.status).toBe("PENDING");

    const approved = await app.inject({
      method: "POST",
      url: `/admin/withdrawals/${withdrawal.id}/approve`,
      headers: { "x-api-key": config.adminApiKey },
      payload: { actor: "test-admin" }
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().status).toBe("APPROVED");
    expect(approved.json().payoutTxHash).toContain("testnet_tx_");

    await app.close();
  });

  it("keeps wrong-tag deposits in the unmatched queue and allows manual assignment", async () => {
    const service = new InMemoryVaultService(config.custodyAddress);
    const app = await buildApp(config, service);
    const userResponse = await app.inject({
      method: "POST",
      url: "/users",
      headers: { "x-api-key": config.userApiKey },
      payload: {}
    });
    const user = userResponse.json();

    const unmatched = await service.recordIncomingPayment({
      txHash: "DEPOSIT_WRONG_TAG",
      ledgerIndex: 2n,
      senderAddress: "rSENDER",
      destinationTag: 999,
      amountDrops: 1_000_000n
    });
    expect(unmatched.status).toBe("UNMATCHED");

    const assigned = await app.inject({
      method: "POST",
      url: `/admin/deposits/${unmatched.id}/assign-user`,
      headers: { "x-api-key": config.adminApiKey },
      payload: { userId: user.id, actor: "ops" }
    });
    expect(assigned.statusCode).toBe(200);
    expect(assigned.json().status).toBe("CREDITED");

    await app.close();
  });
});
