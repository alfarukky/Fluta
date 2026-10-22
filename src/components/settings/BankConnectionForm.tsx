"use client";

import { CircleCheckIcon } from "lucide-react";
import { useId, useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import {
  changeSettlementAccount,
  connectSettlementAccount,
  resolveSettlementAccount,
  type ConnectedAccountView,
  type ResolvedAccountView,
} from "@/actions/payment-settings";
import { useScrollToFirstError } from "@/components/forms/scroll-to-first-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { BankPicker, type BankChoice } from "./BankPicker";
import { describedBy, FormField } from "./FormField";

// Paystack's bank id (unique; a few banks share a code) and name.
export type BankOption = BankChoice;

interface BankConnectionFormProps {
  // "connect" the first time; "change" asks for the password as well.
  mode: "connect" | "change";
  banks: BankOption[];
  // Pre-filled business name (the store name), connect only.
  defaultBusinessName?: string;
  onDone: (account: ConnectedAccountView) => void;
  onCancel?: () => void;
}

const HINTS = {
  businessName: "The name Paystack shows for your store. Usually your store name.",
  accountNumber: "Your 10-digit NUBAN account number. Payments are paid into this account.",
  password: "For your security, enter the password you sign in with.",
};

// Bank → account number → "Check account" (the name Paystack finds) → the
// owner confirms it's theirs → connect (or change). Editing the bank or
// number after checking clears the check, so what's confirmed is always
// what's sent. The server checks it against its own lookup either way.
export function BankConnectionForm({ mode, banks, defaultBusinessName = "", onDone, onCancel }: BankConnectionFormProps) {
  const id = useId();
  const [businessName, setBusinessName] = useState(defaultBusinessName);
  const [bankId, setBankId] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [password, setPassword] = useState("");
  const [resolved, setResolved] = useState<ResolvedAccountView | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const { ref, scrollToFirstError } = useScrollToFirstError();

  function clearCheck() {
    setResolved(null);
    setErrors({});
  }

  function fail(message: string, fieldErrors: Record<string, string> = {}) {
    setErrors(fieldErrors);
    scrollToFirstError();
    toast.error(message);
  }

  function check(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData();
    formData.set("bankId", bankId);
    formData.set("accountNumber", accountNumber);
    startTransition(async () => {
      try {
        const result = await resolveSettlementAccount(formData);
        if (result.ok) {
          setErrors({});
          setResolved(result.values);
        } else {
          fail(result.message, result.fieldErrors);
        }
      } catch {
        fail("We couldn't check that account. Please try again.");
      }
    });
  }

  function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resolved) return;
    const formData = new FormData();
    formData.set("bankId", bankId);
    formData.set("accountNumber", accountNumber);
    formData.set("accountName", resolved.accountName);
    if (mode === "connect") formData.set("businessName", businessName);
    else formData.set("password", password);
    startTransition(async () => {
      try {
        const result = mode === "connect" ? await connectSettlementAccount(formData) : await changeSettlementAccount(formData);
        if (result.ok) {
          toast.success(result.message);
          onDone(result.values);
          return;
        }
        // A problem with the account itself sends the owner back to check it.
        if (result.fieldErrors?.bankId || result.fieldErrors?.accountNumber) setResolved(null);
        fail(result.message, result.fieldErrors);
      } catch {
        fail(mode === "connect" ? "We couldn't connect your bank account. Please try again." : "We couldn't change your bank account. Please try again.");
      }
    });
  }

  const invalid = (field: string) => (errors[field] ? true : undefined);

  return (
    <form ref={ref} onSubmit={resolved ? confirm : check} className="flex flex-col gap-form" noValidate>
      {mode === "connect" && (
        <FormField id={`${id}-business`} label="Business name" hint={HINTS.businessName} error={errors.businessName}>
          <Input
            id={`${id}-business`}
            value={businessName}
            onChange={(event) => setBusinessName(event.target.value)}
            required
            minLength={2}
            maxLength={100}
            autoComplete="organization"
            aria-invalid={invalid("businessName")}
            aria-describedby={describedBy(`${id}-business`, HINTS.businessName, errors.businessName)}
          />
        </FormField>
      )}

      <FormField id={`${id}-bank`} label="Bank" error={errors.bankId}>
        <BankPicker
          id={`${id}-bank`}
          banks={banks}
          value={bankId}
          onChange={(value) => {
            setBankId(value);
            clearCheck();
          }}
          disabled={pending}
          aria-invalid={invalid("bankId")}
          aria-describedby={describedBy(`${id}-bank`, undefined, errors.bankId)}
        />
      </FormField>

      <FormField id={`${id}-account`} label="Account number" hint={HINTS.accountNumber} error={errors.accountNumber}>
        <Input
          id={`${id}-account`}
          value={accountNumber}
          onChange={(event) => {
            setAccountNumber(event.target.value);
            clearCheck();
          }}
          inputMode="numeric"
          autoComplete="off"
          maxLength={13}
          required
          aria-invalid={invalid("accountNumber")}
          aria-describedby={describedBy(`${id}-account`, HINTS.accountNumber, errors.accountNumber)}
        />
      </FormField>

      {resolved && (
        <div role="status" className="flex flex-col gap-component rounded-lg border border-border bg-muted p-card">
          <div className="flex items-start gap-2">
            <CircleCheckIcon className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="type-body text-foreground">
                Account name: <span className="font-semibold break-words">{resolved.accountName}</span>
              </p>
              <p className="type-body-sm text-muted-foreground">
                {resolved.bankName}. Is this your account?
              </p>
            </div>
          </div>

          {mode === "change" && (
            <FormField id={`${id}-password`} label="Your password" hint={HINTS.password} error={errors.password}>
              <Input
                id={`${id}-password`}
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
                aria-invalid={invalid("password")}
                aria-describedby={describedBy(`${id}-password`, HINTS.password, errors.password)}
              />
            </FormField>
          )}
        </div>
      )}

      <div className="flex flex-col-reverse gap-component xs:flex-row xs:justify-end">
        {resolved ? (
          <Button type="button" variant="ghost" onClick={clearCheck} disabled={pending}>
            No, change details
          </Button>
        ) : (
          onCancel && (
            <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
              Cancel
            </Button>
          )
        )}
        <Button type="submit" disabled={pending}>
          {submitLabel(mode, resolved !== null, pending)}
        </Button>
      </div>
    </form>
  );
}

function submitLabel(mode: "connect" | "change", checked: boolean, pending: boolean): string {
  if (!checked) return pending ? "Checking…" : "Check account";
  if (mode === "connect") return pending ? "Connecting…" : "Yes, connect this account";
  return pending ? "Changing…" : "Yes, change to this account";
}
