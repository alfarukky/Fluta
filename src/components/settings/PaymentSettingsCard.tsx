"use client";

import { useId, useState } from "react";

import type { ConnectedAccountView } from "@/actions/payment-settings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { BankConnectionForm, type BankOption } from "./BankConnectionForm";
import { PayLaterToggle } from "./PayLaterToggle";

interface PaymentSettingsCardProps {
  // False when Paystack isn't configured in this environment.
  available: boolean;
  // Null when the bank list couldn't be loaded.
  banks: BankOption[] | null;
  storeName: string;
  initialAccount: ConnectedAccountView | null;
  payLaterEnabled: boolean;
}

const PAYSTACK_FEES = "Paystack's fees are taken from each online payment before it reaches your bank.";

// Settings → Payments (plan 4.2): connect the store's bank account, see it
// once connected, change it, and choose whether customers may pay later.
export function PaymentSettingsCard({ available, banks, storeName, initialAccount, payLaterEnabled }: PaymentSettingsCardProps) {
  const id = useId();
  const [account, setAccount] = useState(initialAccount);
  const [changing, setChanging] = useState(false);

  const bankListMissing = (
    <p role="alert" className="type-body-sm text-error">
      We couldn&apos;t load the list of banks. Refresh the page to try again.
    </p>
  );

  return (
    <Card role="region" aria-labelledby={`${id}-title`}>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle id={`${id}-title`} className="type-h3">
            Online payments
          </CardTitle>
          {available && (
            <Badge variant={account ? "success" : "neutral"} dot>
              {account ? "Connected" : "Not connected"}
            </Badge>
          )}
        </div>
        <CardDescription className="type-body-sm">
          {account
            ? "Customers can pay online. Payments go straight to your bank account."
            : "Connect your bank account so customers can pay online. Payments go straight to your bank account."}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-component">
        {!available ? (
          <p className="type-body-sm text-muted-foreground">Online payments aren&apos;t set up in this environment.</p>
        ) : account && !changing ? (
          <>
            <div className="flex flex-col gap-1 rounded-lg border border-border p-3">
              <p className="type-body text-foreground break-words">
                {account.bankName} · {account.accountName} · <span className="whitespace-nowrap">•••• {account.last4}</span>
              </p>
              <p className="type-caption text-muted-foreground">Connected {account.connectedOn}</p>
            </div>
            <p className="type-caption text-muted-foreground">{PAYSTACK_FEES}</p>
            <PayLaterToggle initialValue={payLaterEnabled} />
            <Button variant="outline" className="w-full xs:w-fit" onClick={() => setChanging(true)} disabled={!banks}>
              Change bank account
            </Button>
            {!banks && bankListMissing}
          </>
        ) : !banks ? (
          bankListMissing
        ) : (
          <>
            {changing && (
              <p className="type-body-sm text-muted-foreground">
                Online payments from now on go to the new account. We&apos;ll email you to confirm the change.
              </p>
            )}
            <BankConnectionForm
              mode={account ? "change" : "connect"}
              banks={banks}
              defaultBusinessName={storeName}
              onDone={(next) => {
                setAccount(next);
                setChanging(false);
              }}
              onCancel={account ? () => setChanging(false) : undefined}
            />
            {!account && (
              <p className="border-t border-border pt-component type-caption text-muted-foreground">{PAYSTACK_FEES}</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
