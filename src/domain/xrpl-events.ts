export interface IncomingXrpPayment {
  txHash: string;
  ledgerIndex: bigint;
  senderAddress: string;
  destinationTag?: number;
  amountDrops: bigint;
  raw: unknown;
}

function getTransaction(event: Record<string, unknown>): Record<string, unknown> | undefined {
  const transaction = event.transaction ?? event.tx ?? event.tx_json;
  return typeof transaction === "object" && transaction !== null
    ? (transaction as Record<string, unknown>)
    : undefined;
}

function getMeta(event: Record<string, unknown>): Record<string, unknown> | undefined {
  const meta = event.meta ?? event.metaData ?? event.meta_data;
  return typeof meta === "object" && meta !== null ? (meta as Record<string, unknown>) : undefined;
}

function getDeliveredAmount(event: Record<string, unknown>, tx: Record<string, unknown>): unknown {
  const meta = getMeta(event);
  return meta?.delivered_amount ?? event.delivered_amount ?? tx.Amount;
}

export function parseIncomingXrpPayment(
  event: Record<string, unknown>,
  custodyAddress: string
): IncomingXrpPayment | null {
  const tx = getTransaction(event);
  if (!tx) {
    return null;
  }

  const meta = getMeta(event);
  if (event.validated === false) {
    return null;
  }
  if (meta?.TransactionResult && meta.TransactionResult !== "tesSUCCESS") {
    return null;
  }
  if (tx.TransactionType !== "Payment") {
    return null;
  }
  if (tx.Destination !== custodyAddress) {
    return null;
  }
  if (tx.Account === custodyAddress) {
    return null;
  }

  const deliveredAmount = getDeliveredAmount(event, tx);
  if (typeof deliveredAmount !== "string" || !/^\d+$/.test(deliveredAmount)) {
    return null;
  }

  const txHash = String(tx.hash ?? event.hash ?? "");
  const ledgerIndexValue = tx.ledger_index ?? event.ledger_index ?? event.ledgerIndex;
  if (!txHash || ledgerIndexValue === undefined) {
    return null;
  }

  const destinationTag =
    typeof tx.DestinationTag === "number" && Number.isInteger(tx.DestinationTag)
      ? tx.DestinationTag
      : undefined;

  return {
    txHash,
    ledgerIndex: BigInt(String(ledgerIndexValue)),
    senderAddress: String(tx.Account),
    destinationTag,
    amountDrops: BigInt(deliveredAmount),
    raw: event
  };
}
