import "dotenv/config";

export interface AppConfig {
  nodeEnv: string;
  port: number;
  databaseUrl: string;
  xrplNetwork: string;
  custodyAddress: string;
  custodySeed?: string;
  requireDestinationTag: boolean;
  userApiKey: string;
  adminApiKey: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function loadConfig(): AppConfig {
  return {
    nodeEnv: process.env.NODE_ENV ?? "development",
    port: Number(process.env.PORT ?? 8080),
    databaseUrl: requireEnv("DATABASE_URL"),
    xrplNetwork: process.env.XRPL_NETWORK ?? "wss://s.altnet.rippletest.net:51233",
    custodyAddress: requireEnv("CUSTODY_ADDRESS"),
    custodySeed: process.env.CUSTODY_SEED,
    requireDestinationTag: process.env.REQUIRE_DESTINATION_TAG !== "false",
    userApiKey: requireEnv("USER_API_KEY"),
    adminApiKey: requireEnv("ADMIN_API_KEY")
  };
}
