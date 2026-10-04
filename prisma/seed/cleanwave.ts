import type { SeedStoreSpec } from "./store-builder";

const YUSUF = "+2348090000201";
const BLESSING = "+2348090000202";
// The same number as a FreshFold customer: customers are per store, so this is
// a separate record that FreshFold must never see.
const CHINEDU = "+2348030000101";

export const CLEANWAVE_SLUG = "cleanwave-laundry";

// A second, smaller store for tenant-isolation tests. Not connected to
// Paystack, and its current invoice is past due (subscription Overdue).
export function cleanWaveSpec(): SeedStoreSpec {
  return {
    store: {
      name: "CleanWave Laundry",
      slug: CLEANWAVE_SLUG,
      description: "Dry cleaning and laundry in Wuse 2, Abuja.",
      addressText: "18 Cedar Close, Wuse 2, Abuja",
      phone: "+2348090001000",
      email: "care@cleanwave.example",
      brandPrimaryColor: "#1E3A8A",
      timeZone: "Africa/Lagos",
      orderPrefix: "CW",
      pickupDeliveryEnabled: true,
      activeDays: [1, 2, 3, 4, 5],
      openTime: "09:00",
      closeTime: "17:00",
    },
    areas: [{ name: "Wuse 2", chargeType: "FIXED", fixedCharge: 80_000 }],
    services: [
      { name: "Shirt", category: "Laundry", pricingType: "PER_ITEM", price: 70_000 },
      { name: "Suit", category: "Dry cleaning", pricingType: "PER_ITEM", price: 350_000 },
      { name: "Duvet", category: "Household", pricingType: "PER_PACKAGE", price: 300_000 },
    ],
    customers: [
      { name: "Yusuf Danjuma", phone: YUSUF },
      { name: "Blessing Okon", phone: BLESSING, email: "blessing.okon@example.com" },
      { name: "Chinedu Okafor", phone: CHINEDU },
    ],
    closedDates: [],
    subscription: { planName: "Pilot", priceAmount: 1_500_000, periodStartedDaysAgo: 10 },
    orders: [
      {
        customerPhone: YUSUF,
        channel: "COUNTER",
        fulfilmentType: "DROP_OFF",
        createdHoursAgo: 8 * 24,
        stages: ["RECEIVED_BY_STORE", "IN_PROGRESS", "READY", "COMPLETED"],
        revisions: [
          {
            lines: [{ service: "Suit", quantity: "1" }, { service: "Shirt", quantity: "4" }],
            status: "APPROVED",
            approvedBy: "STAFF",
          },
        ],
        payments: [{ amount: 630_000, source: "STORE_COLLECTED", method: "CASH", atStep: 3 }],
      },
      {
        customerPhone: CHINEDU,
        channel: "COUNTER",
        fulfilmentType: "DROP_OFF",
        createdHoursAgo: 3 * 24,
        stages: ["RECEIVED_BY_STORE", "IN_PROGRESS"],
        revisions: [{ lines: [{ service: "Duvet", quantity: "1" }], status: "APPROVED", approvedBy: "STAFF" }],
        payments: [{ amount: 300_000, source: "STORE_COLLECTED", method: "POS", atStep: 0 }],
      },
      {
        customerPhone: BLESSING,
        channel: "ONLINE",
        fulfilmentType: "DROP_OFF",
        createdHoursAgo: 5,
        payLater: true,
        stages: ["BOOKED"],
        revisions: [{ lines: [{ service: "Shirt", quantity: "6" }], status: "APPROVED", approvedBy: "CUSTOMER" }],
      },
    ],
  };
}
