import { describe, expect, it } from "vitest";
import { indianMobile, khataReminder, whatsAppDraft } from "@/lib/business/sharing";

describe("merchant sharing drafts", () => {
  it("normalizes valid Indian mobile formats and rejects uncertain numbers", () => {
    expect(indianMobile("+91 98765 43210")).toBe("919876543210");
    expect(indianMobile("09876543210")).toBe("919876543210");
    expect(indianMobile("98765-43210")).toBe("919876543210");
    expect(indianMobile("1234567890")).toBeNull();
    expect(indianMobile("abc9876543210")).toBeNull();
    expect(indianMobile(null)).toBeNull();
  });

  it("drafts a reminder only for a positive balance and known phone", () => {
    const customer = { name: "Sharma ji", phone: "9876543210" };
    const link = khataReminder(customer, 770.5, "QA Mart");
    expect(link).toBeTruthy();
    const url = new URL(link!);
    expect(url.origin).toBe("https://wa.me");
    expect(url.pathname).toBe("/919876543210");
    expect(url.searchParams.get("text")).toContain("₹770.50");
    expect(khataReminder(customer, 0, "QA Mart")).toBeNull();
    expect(khataReminder({ ...customer, phone: null }, 25, "QA Mart")).toBeNull();
  });

  it("can draft an order or receipt without choosing a contact", () => {
    const url = new URL(whatsAppDraft("Order: 2 kg sugar")!);
    expect(url.pathname).toBe("/");
    expect(url.searchParams.get("text")).toBe("Order: 2 kg sugar");
  });
});
