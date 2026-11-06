import { describe, expect, it } from "vitest";
import { indianMobileError, indianMobileInsertionError, indianMobileSchema } from "../src/lib/business/indian-mobile";
import { businessActionSchema } from "../src/lib/business/schemas";
import { profileUpdateSchema } from "../src/lib/auth/profile-schema";

describe("Indian mobile number validation", () => {
  it.each(["6000000000", "7123456789", "8999999999", "9999999999"])("accepts a 10-digit mobile beginning with 6–9: %s", (number) => {
    expect(indianMobileSchema.safeParse(number).success).toBe(true);
    expect(indianMobileError(number)).toBeNull();
  });

  it.each(["5123456789", "987654321", "98765432101"])("rejects an invalid length or starting digit: %s", (number) => {
    expect(indianMobileSchema.safeParse(number).success).toBe(false);
    expect(indianMobileError(number)).toBe("Enter a valid 10-digit Indian mobile number");
  });

  it.each(["98765abc10", "+919876543210", "98765-43210", "98765 43210"])("rejects letters and formatting characters: %s", (number) => {
    expect(indianMobileSchema.safeParse(number).success).toBe(false);
    expect(indianMobileError(number)).toBe("Only digits are allowed");
  });

  it("shows a validation message when typing or pasting would exceed ten digits", () => {
    expect(indianMobileInsertionError("9876543210", 10, 10, "1")).toBe("Enter a valid 10-digit Indian mobile number");
    expect(indianMobileInsertionError("9876543210", 10, 10, "x")).toBe("Only digits are allowed");
    expect(indianMobileInsertionError("98765", 5, 5, "43210")).toBeNull();
  });

  it("keeps optional phone fields optional while validating provided numbers at each API schema", () => {
    const phone = "9876543210";
    expect(profileUpdateSchema.safeParse({ field: "phone", value: null }).success).toBe(true);
    expect(profileUpdateSchema.safeParse({ field: "phone", value: phone }).success).toBe(true);
    expect(profileUpdateSchema.safeParse({ field: "phone", value: "+91 9876543210" }).success).toBe(false);
    expect(businessActionSchema.safeParse({ kind: "customer.create", name: "Rani" }).success).toBe(true);
    expect(businessActionSchema.safeParse({ kind: "customer.create", name: "Rani", phone }).success).toBe(true);
    expect(businessActionSchema.safeParse({ kind: "customer.create", name: "Rani", phone: "987654321" }).success).toBe(false);
    expect(businessActionSchema.safeParse({ kind: "supplier.create", name: "Wholesale" }).success).toBe(true);
    expect(businessActionSchema.safeParse({ kind: "supplier.create", name: "Wholesale", phone }).success).toBe(true);
    expect(businessActionSchema.safeParse({ kind: "supplier.edit", id: "11111111-1111-4111-8111-111111111111", name: "Wholesale", contactName: null, phone: null }).success).toBe(true);
    expect(businessActionSchema.safeParse({ kind: "supplier.edit", id: "11111111-1111-4111-8111-111111111111", name: "Wholesale", contactName: null, phone: "1234567890" }).success).toBe(false);
  });
});
