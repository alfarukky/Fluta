import { ArrowDownIcon } from "lucide-react";
import type { Metadata } from "next";

import { AccessDenied } from "@/components/auth/AccessDenied";
import { BrandingForm } from "@/components/settings/BrandingForm";
import { CustomerBookingCard } from "@/components/settings/CustomerBookingCard";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { StoreProfileForm } from "@/components/settings/StoreProfileForm";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/workspace/PageHeader";
import { summarizeStoreStatus } from "@/components/workspace/store-status";
import { getBookingShare } from "@/lib/booking-link";
import { getLogoUrl } from "@/lib/logo-url";
import { formatPhone } from "@/lib/phone";
import { requireStoreMember } from "@/server/auth/session";
import { getStoreSettings } from "@/server/data/stores";

export const metadata: Metadata = { title: "Settings · Fluta" };

export default async function SettingsPage() {
  const member = await requireStoreMember({ role: "OWNER" });
  if (!member.allowed) return <AccessDenied reason={member.reason} />;

  const settings = await getStoreSettings(member.store.id);
  const { bookingUrl, qrCodePng } = await getBookingShare(settings);
  const status = summarizeStoreStatus(member.store.status, member.access, member.membership.role);
  const { host } = new URL(bookingUrl);

  return (
    <main className="page-container flex flex-1 flex-col gap-section py-section">
      <div className="flex flex-col gap-section">
        <PageHeader title="Store settings" description="Keep your store identity accurate for you and your customers." />
        <SettingsNav />
      </div>

      <div className="grid items-start gap-grid lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-grid lg:col-span-2">
          <StoreProfileForm
            initialValues={{
              name: settings.name,
              description: settings.description ?? "",
              address: settings.addressText ?? "",
              phone: settings.phone ? formatPhone(settings.phone) : "",
              email: settings.email ?? "",
            }}
            slug={settings.slug}
            linkPrefix={`${host}/store/`}
          >
            <CustomerBookingCard bookingUrl={bookingUrl} qrCodePng={qrCodePng} status={status} slug={settings.slug} />
          </StoreProfileForm>

          <BrandingForm
            storeName={settings.name}
            initialColors={{
              primaryColor: settings.brandPrimaryColor ?? "",
              accentColor: settings.brandAccentColor ?? "",
            }}
            initialLogoUrl={getLogoUrl(settings)}
          />
        </div>

        <Card className="order-first lg:order-none">
          <CardContent className="flex flex-col gap-component">
            <p className="type-caption font-semibold tracking-wider text-muted-foreground uppercase">Next step</p>
            <p className="type-h3 text-foreground">Make your storefront feel like yours.</p>
            <p className="type-body-sm text-muted-foreground">Add a logo and colours so customers recognise your store.</p>
            <a
              href="#branding"
              className="type-label mt-1 inline-flex w-fit items-center gap-1 rounded-sm text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              Go to branding
              <ArrowDownIcon className="size-4" aria-hidden />
            </a>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
