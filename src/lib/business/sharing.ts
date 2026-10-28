import { rupees } from "./calculations";

export function indianMobile(phone: string | null): string | null {
  if (!phone || /[^\d\s()+-]/u.test(phone)) return null;
  const digits = phone.replace(/\D/gu, "");
  const local = digits.length === 10 ? digits
    : digits.length === 11 && digits.startsWith("0") ? digits.slice(1)
      : digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : "";
  return /^[6-9]\d{9}$/u.test(local) ? `91${local}` : null;
}

export function whatsAppDraft(message: string, phone?: string | null): string | null {
  const number = phone === undefined ? "" : indianMobile(phone);
  if (number === null) return null;
  const url = new URL(`https://wa.me/${number}`);
  url.searchParams.set("text", message);
  return url.toString();
}

export function khataReminder(customer: { name: string; phone: string | null }, balance: number, shopName: string): string | null {
  if (balance <= 0 || !Number.isFinite(balance)) return null;
  return whatsAppDraft(`Namaste ${customer.name}, your khata balance at ${shopName} is ${rupees(balance)}. Please pay when convenient. Thank you.`, customer.phone);
}
