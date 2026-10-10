import { useId, type ReactNode } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface OrderSectionProps {
  title: string;
  description?: string;
  children: ReactNode;
}

// One step of the new-order page (Customer, Order details, Lines, Review).
export function OrderSection({ title, description, children }: OrderSectionProps) {
  const id = useId();
  return (
    <Card role="region" aria-labelledby={id}>
      <CardHeader>
        <CardTitle id={id} className="type-h3">
          {title}
        </CardTitle>
        {description && <CardDescription className="type-body-sm">{description}</CardDescription>}
      </CardHeader>
      <CardContent className="flex flex-col gap-form">{children}</CardContent>
    </Card>
  );
}
