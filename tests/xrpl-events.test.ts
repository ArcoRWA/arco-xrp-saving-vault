import { parseIncomingXrpPayment } from "../src/domain/xrpl-events.js";

const custodyAddress = "rCUSTODY_TEST_ADDRESS";

function paymentEvent(overrides: Record<string, unknown> = {}) {
  return {
    validated: true,
    transaction: {
      hash: "ABC123",
      ledger_index: 123,
      TransactionType: "Payment",
      Account: "rSENDER",
      Destination: custodyAddress,
      DestinationTag: 42,
      Amount: "1000000"
    },
    meta: {
      TransactionResult: "tesSUCCESS",
      delivered_amount: "1000000"
    },
    ...overrides
  };
}

describe("XRPL incoming payment parser", () => {
  it("accepts validated XRP payments to custody with destination tags", () => {
    const parsed = parseIncomingXrpPayment(paymentEvent(), custodyAddress);
    expect(parsed).toEqual(
      expect.objectContaining({
        txHash: "ABC123",
        ledgerIndex: 123n,
        senderAddress: "rSENDER",
        destinationTag: 42,
        amountDrops: 1_000_000n
      })
    );
  });

  it("ignores failed transactions", () => {
    const parsed = parseIncomingXrpPayment(
      paymentEvent({ meta: { TransactionResult: "tecPATH_DRY", delivered_amount: "1000000" } }),
      custodyAddress
    );
    expect(parsed).toBeNull();
  });

  it("ignores non-XRP issued-currency payments", () => {
    const parsed = parseIncomingXrpPayment(
      paymentEvent({ meta: { TransactionResult: "tesSUCCESS", delivered_amount: { currency: "USD" } } }),
      custodyAddress
    );
    expect(parsed).toBeNull();
  });

  it("ignores outgoing custody payments", () => {
    const parsed = parseIncomingXrpPayment(
      paymentEvent({
        transaction: {
          hash: "ABC123",
          ledger_index: 123,
          TransactionType: "Payment",
          Account: custodyAddress,
          Destination: "rOTHER",
          Amount: "1000000"
        }
      }),
      custodyAddress
    );
    expect(parsed).toBeNull();
  });
});
