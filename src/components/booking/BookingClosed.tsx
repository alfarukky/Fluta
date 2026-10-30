import { PhoneIcon } from "lucide-react";

import { formatServicePrice } from "@/lib/money";
import type { BookingAvailability, BookingService, PublicStore } from "@/types/booking";

interface BookingClosedProps {
  store: PublicStore;
  availability: Exclude<BookingAvailability, "OPEN">;
  services: BookingService[];
}

// No booking form. A store that isn't taking new bookings still shows its
// services. One that can't take online bookings shows only the message.
export function BookingClosed({ store, availability, services }: BookingClosedProps) {
  const message =
    availability === "NOT_ACCEPTING"
      ? `${store.name} isn't taking new bookings right now. Please contact the store.`
      : "This store isn't taking online bookings right now. Please contact the store.";

  return (
    <>
      <section role="status" className="flex flex-col gap-component rounded-xl border border-border bg-card p-card">
        <p className="type-body text-card-foreground">{message}</p>
        {store.phone && store.phoneHref && (
          <a
            href={store.phoneHref}
            className="type-label inline-flex min-h-11 items-center gap-2 self-start rounded-lg border border-border px-4 text-foreground hover:bg-muted"
          >
            <PhoneIcon className="size-4" aria-hidden />
            Call {store.phone}
          </a>
        )}
      </section>

      {availability === "NOT_ACCEPTING" && services.length > 0 && (
        <section aria-labelledby="services-heading" className="flex flex-col gap-component">
          <h2 id="services-heading" className="type-h2 text-foreground">
            Services
          </h2>
          <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
            {services.map((service) => (
              <li key={service.id} className="flex items-start justify-between gap-component p-card">
                <span className="type-label wrap-break-word text-card-foreground">{service.name}</span>
                <span className="type-body-sm shrink-0 text-muted-foreground">{formatServicePrice(service)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
