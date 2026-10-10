import { PlusIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AccessDenied } from "@/components/auth/AccessDenied";
import { Button } from "@/components/ui/button";
import { ComingSoon } from "@/components/workspace/ComingSoon";
import { requireStoreMember } from "@/server/auth/session";

export const metadata: Metadata = { title: "Orders · Fluta" };

export default async function OrdersPage() {
  const member = await requireStoreMember();
  if (!member.allowed) return <AccessDenied reason={member.reason} />;

  // The list itself is Feature 10.
  return (
    <ComingSoon
      href="/orders"
      actions={
        <Button asChild>
          <Link href="/orders/new">
            <PlusIcon data-icon="inline-start" aria-hidden />
            New order
          </Link>
        </Button>
      }
    />
  );
}
