"use client";

import { Printer } from "lucide-react";

export function PrintReceiptButton() {
  return <button type="button" onClick={() => window.print()}><Printer size={16} aria-hidden="true" /> Print or save PDF</button>;
}
