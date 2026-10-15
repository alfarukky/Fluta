import type { Metadata } from "next";

import { AccessDenied } from "@/components/auth/AccessDenied";
import { ServiceCatalogue } from "@/components/services/ServiceCatalogue";
import { requireStoreMember } from "@/server/auth/session";
import { listServices } from "@/server/data/services";

export const metadata: Metadata = { title: "Services · Fluta" };

export default async function ServicesPage() {
  const member = await requireStoreMember({ role: "OWNER" });
  if (!member.allowed) return <AccessDenied reason={member.reason} />;

  const services = await listServices(member.store.id);
  return <ServiceCatalogue services={services} />;
}
