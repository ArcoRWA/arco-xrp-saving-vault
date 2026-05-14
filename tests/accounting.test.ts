import { Decimal } from "decimal.js";
import {
  applyDeposit,
  applyWithdrawalApproval,
  applyYield,
  initialVaultSnapshot,
  quoteWithdrawal
} from "../src/domain/accounting.js";
import { decimalToDropsFloor } from "../src/lib/money.js";

describe("vault share accounting", () => {
  it("mints shares at the current index and increases index on yield", () => {
    let snapshot = initialVaultSnapshot();

    const firstDeposit = applyDeposit(snapshot, 100_000_000n);
    expect(firstDeposit.mintedShares.toString()).toBe("100000000");
    snapshot = firstDeposit.next;

    const yieldEvent = applyYield(snapshot, 10_000_000n);
    snapshot = yieldEvent.next;
    expect(snapshot.shareIndex.toString()).toBe("1.1");

    const secondDeposit = applyDeposit(snapshot, 110_000_000n);
    snapshot = secondDeposit.next;
    expect(secondDeposit.mintedShares.toString()).toBe("100000000");
    expect(snapshot.totalShares.toString()).toBe("200000000");
    expect(snapshot.shareIndex.toString()).toBe("1.1");
  });

  it("quotes full withdrawals using floor rounding", () => {
    const quote = quoteWithdrawal(new Decimal("10.5"), new Decimal("1.25"));
    expect(quote.payoutDrops).toBe(13n);
    expect(quote.sharesToBurn.toString()).toBe("10.5");
    expect(quote.fullWithdrawal).toBe(true);
  });

  it("quotes partial withdrawals by burning proportional shares", () => {
    const quote = quoteWithdrawal(new Decimal("100000000"), new Decimal("1.1"), 55_000_000n);
    expect(quote.payoutDrops).toBe(55_000_000n);
    expect(quote.sharesToBurn.toString()).toBe("50000000");
    expect(quote.fullWithdrawal).toBe(false);
  });

  it("keeps index stable when a proportional approved withdrawal exits", () => {
    let snapshot = initialVaultSnapshot();
    snapshot = applyDeposit(snapshot, 100_000_000n).next;
    snapshot = applyYield(snapshot, 10_000_000n).next;

    const quote = quoteWithdrawal(snapshot.totalShares, snapshot.shareIndex, 55_000_000n);
    snapshot.totalShares = snapshot.totalShares.minus(quote.sharesToBurn);
    snapshot = applyWithdrawalApproval(snapshot, quote.payoutDrops);

    expect(snapshot.totalAssetsDrops).toBe(55_000_000n);
    expect(snapshot.totalShares.toString()).toBe("50000000");
    expect(snapshot.shareIndex.toString()).toBe("1.1");
    expect(decimalToDropsFloor(snapshot.totalShares.mul(snapshot.shareIndex))).toBe(55_000_000n);
  });

  it("rejects yield before any depositor shares exist", () => {
    expect(() => applyYield(initialVaultSnapshot(), 1n)).toThrow("cannot apply yield");
  });
});
