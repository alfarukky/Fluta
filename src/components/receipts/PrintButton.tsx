"use client";

import { PrinterIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

// The browser's own print dialog. Its "Save as PDF" lets staff keep a copy to share.
export function PrintButton() {
  return (
    <Button variant="primary" onClick={() => window.print()}>
      <PrinterIcon data-icon="inline-start" aria-hidden />
      Print
    </Button>
  );
}
