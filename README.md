# Arco XRP Saving Vault

XRPL testnet backend for the Arco XRP Saving Vault MVP.

This service models a custody-style XRP saving vault:

- users receive a shared testnet custody address plus a unique XRPL `DestinationTag`
- incoming XRP payments are credited as vault shares
- vault yield is applied through admin yield events
- withdrawals are requested by users and approved by an operator
- all XRP accounting is done in integer drops, with share math isolated in domain tests

## Status

This repository is a testnet proof, not a production custody system and not an investment product. Do not use mainnet funds, production keys, or customer data with this MVP.

## Stack

- Node.js + TypeScript
- Fastify API
- Prisma + Postgres
- xrpl.js for XRPL testnet monitoring and payout submission
- Vitest for unit and API tests

## Local Setup

```bash
npm install
cp .env.example .env
docker compose up -d
npm run prisma:generate
npm run prisma:migrate
npm run dev
```

Run the XRPL deposit worker in a separate terminal:

```bash
npm run dev:worker
```

## Environment

Required values live in `.env.example`. Real `.env` files are ignored by Git.

Important variables:

- `DATABASE_URL`: Postgres connection string
- `XRPL_NETWORK`: defaults to XRPL testnet
- `CUSTODY_ADDRESS`: shared testnet receiving address
- `CUSTODY_SEED`: testnet seed used only for approved withdrawals
- `USER_API_KEY`: API key for user routes
- `ADMIN_API_KEY`: API key for admin routes

## API

All routes except `/health` require `x-api-key`.

User routes:

- `POST /users`
- `GET /users/:id/balance`
- `GET /users/:id/deposits`
- `GET /users/:id/withdrawals`
- `POST /withdrawals`

Admin routes:

- `GET /admin/vault`
- `POST /admin/yield-events`
- `GET /admin/deposits/unmatched`
- `POST /admin/deposits/:id/assign-user`
- `POST /admin/withdrawals/:id/approve`
- `POST /admin/withdrawals/:id/reject`

Example user creation:

```bash
curl -X POST http://localhost:8080/users \
  -H "x-api-key: $USER_API_KEY" \
  -H "content-type: application/json" \
  -d '{"externalId":"demo-user"}'
```

Example yield event:

```bash
curl -X POST http://localhost:8080/admin/yield-events \
  -H "x-api-key: $ADMIN_API_KEY" \
  -H "content-type: application/json" \
  -d '{"amountDrops":"1000000","memo":"testnet RWA yield event","createdBy":"ops"}'
```

## Accounting Model

- Initial share index is `1`.
- Deposit credit: `mintedShares = depositDrops / currentShareIndex`.
- Yield event: total vault assets increase, total shares stay fixed, share index increases.
- Withdrawal request: shares are locked and payout quote is fixed.
- Withdrawal approval: testnet XRP payment is submitted, locked shares are burned, vault assets decrease.
- Withdrawal rejection or payout failure: locked shares are released.

All monetary fields returned by the API are strings to avoid JSON precision loss.

## Validation

```bash
npm test
npm run typecheck
npm run build
npm run prisma:validate
```

## GitHub Target

Planned private repository:

```text
ArcoRWA/arco-xrp-saving-vault
```
