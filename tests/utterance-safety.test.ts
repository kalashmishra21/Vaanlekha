import { describe, expect, it } from "vitest";
import { isGroundedToolCall } from "../src/lib/assistant/utterance-safety";

describe("grounded product names", () => {
  it.each([
    "10 packet maggie add kro",
    "मैगी के 20 पैकेट जोड़ दो",
  ])("accepts the saved Maggi identity for alias request %s", (text) => {
    expect(isGroundedToolCall(text, { intent: "inventory.adjust", arguments: { product: "Maggi", delta: text.includes("20") ? 20 : 10 } })).toBe(true);
  });

  it("grounds a Hindi sale verb without allowing a contradictory stock action", () => {
    expect(isGroundedToolCall("आज 5 पैकेट मैगी बेच दो", {
      intent: "sales.recordSpoken", arguments: { items: [{ product: "Maggi", quantity: 5, unit: "packet" }] },
    })).toBe(true);
    expect(isGroundedToolCall("10 packet Maggie remove kro", {
      intent: "inventory.adjust", arguments: { product: "Maggi", delta: 10 },
    })).toBe(false);
  });

  it("accepts a generic Hindi order-status question only as a lookup", () => {
    expect(isGroundedToolCall("Is order ka status batao", {
      intent: "orders.getStatus", arguments: { order: "this order" },
    })).toBe(true);
  });

  it.each([
    ["Rahul ne 100 rupaye ka udhaar liya", "gave", true],
    ["Rahul ne 50 rupaye wapas kar diye", "received", true],
    ["Rahul ne 100 rupaye liya", "gave", false],
    ["Rahul ne 100 rupaye udhaar liya", "received", false],
  ] as const)("requires ledger evidence for %s as %s", (text, type, expected) => {
    expect(isGroundedToolCall(text, { intent: "khata.addEntry", arguments: { customer: "Rahul", type, amountRupees: Number(text.match(/\d+/)?.[0]) } })).toBe(expected);
  });
});
