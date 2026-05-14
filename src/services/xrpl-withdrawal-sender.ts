import { Client, Wallet, type Payment } from "xrpl";
import type { WithdrawalSender } from "./types.js";

export class XrplWithdrawalSender implements WithdrawalSender {
  constructor(
    private readonly networkUrl: string,
    private readonly custodySeed: string
  ) {}

  async sendPayment(input: {
    destinationAddress: string;
    destinationTag?: number;
    amountDrops: bigint;
  }): Promise<{ txHash: string }> {
    const client = new Client(this.networkUrl);
    await client.connect();
    try {
      const wallet = Wallet.fromSeed(this.custodySeed);
      const payment: Payment = {
        TransactionType: "Payment",
        Account: wallet.classicAddress,
        Destination: input.destinationAddress,
        Amount: input.amountDrops.toString()
      };
      if (input.destinationTag !== undefined) {
        payment.DestinationTag = input.destinationTag;
      }

      const prepared = await client.autofill(payment);
      const signed = wallet.sign(prepared);
      const result = await client.submitAndWait(signed.tx_blob);

      if (result.result.meta && typeof result.result.meta !== "string") {
        const status = result.result.meta.TransactionResult;
        if (status !== "tesSUCCESS") {
          throw new Error(`XRPL payment failed with ${status}`);
        }
      }

      return { txHash: signed.hash };
    } finally {
      await client.disconnect();
    }
  }
}
