import type { SeedStoreSpec } from "./store-builder";

// Fictional customers. +44 7700 900xxx is Ofcom's range reserved for drama, and
// shows a non-Nigerian number (no automatic SMS).
const CHINEDU = "+2348030000101";
const AISHA = "+2348030000102";
const TUNDE = "+2348030000103";
const NGOZI = "+2348030000104";
const IBRAHIM = "+2348030000105";
const FUNMILAYO = "+2348030000106";
const EMEKA = "+2348030000107";
const HALIMA = "+2348030000108";
const SEGUN = "+447700900123";

const LEKKI = "Lekki Phase 1";
const AJAH = "Ajah";

export const FRESHFOLD_SLUG = "freshfold-laundry";

function nextChristmas(now: Date): Date {
  const year = now.getUTCMonth() === 11 && now.getUTCDate() > 25 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
  return new Date(Date.UTC(year, 11, 25));
}

export function freshFoldSpec(now: Date): SeedStoreSpec {
  return {
    store: {
      name: "FreshFold Laundry",
      slug: FRESHFOLD_SLUG,
      description: "Wash, iron and fold in Lekki. Pickup and delivery across Lekki Phase 1 and Ajah.",
      addressText: "12 Admiralty Way, Lekki Phase 1, Lagos",
      phone: "+2348030001234",
      email: "hello@freshfold.example",
      brandPrimaryColor: "#173C32",
      timeZone: "Africa/Lagos",
      orderPrefix: "FF",
      pickupDeliveryEnabled: true,
      payLaterEnabled: true,
      activeDays: [1, 2, 3, 4, 5, 6],
      openTime: "08:00",
      closeTime: "18:00",
      paystackSubaccountCode: "ACCT_seedfreshfold",
      settlementBankName: "Example Bank",
      settlementAccountName: "FRESHFOLD LAUNDRY SERVICES",
      settlementAccountLast4: "4821",
      paystackConnectedAt: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000),
    },
    areas: [
      { name: LEKKI, chargeType: "FIXED", fixedCharge: 100_000 },
      { name: AJAH, chargeType: "QUOTE_REQUIRED" },
    ],
    services: [
      { name: "Shirt", category: "Wash & iron", pricingType: "PER_ITEM", price: 80_000 },
      { name: "Trousers", category: "Wash & iron", pricingType: "PER_ITEM", price: 100_000 },
      { name: "Dress", category: "Wash & iron", pricingType: "PER_ITEM", price: 150_000 },
      { name: "Bedding", category: "Household", pricingType: "PER_PACKAGE", price: 250_000 },
      { name: "Laundry by weight", category: "Wash & fold", pricingType: "PER_KG", price: 150_000 },
    ],
    customers: [
      { name: "Chinedu Okafor", phone: CHINEDU, email: "chinedu.okafor@example.com" },
      { name: "Aisha Bello", phone: AISHA, email: "aisha.bello@example.com" },
      { name: "Tunde Adeyemi", phone: TUNDE },
      { name: "Ngozi Eze", phone: NGOZI, email: "ngozi.eze@example.com" },
      { name: "Ibrahim Musa", phone: IBRAHIM },
      { name: "Funmilayo Ogunleye", phone: FUNMILAYO, email: "funmi.ogunleye@example.com" },
      { name: "Emeka Nwosu", phone: EMEKA },
      { name: "Halima Abubakar", phone: HALIMA, email: "halima.abubakar@example.com" },
      { name: "Segun Bakare", phone: SEGUN },
    ],
    closedDates: [{ date: nextChristmas(now), note: "Christmas Day" }],
    subscription: { planName: "Pilot", priceAmount: 1_500_000, periodStartedDaysAgo: 2 },
    orders: [
      // Completed counter order, paid in cash.
      {
        customerPhone: CHINEDU,
        channel: "COUNTER",
        fulfilmentType: "DROP_OFF",
        createdHoursAgo: 20 * 24,
        stages: ["RECEIVED_BY_STORE", "IN_PROGRESS", "READY", "COMPLETED"],
        revisions: [
          {
            lines: [{ service: "Shirt", quantity: "4" }, { service: "Trousers", quantity: "2" }],
            status: "APPROVED",
            approvedBy: "STAFF",
          },
        ],
        payments: [{ amount: 520_000, source: "STORE_COLLECTED", method: "CASH", atStep: 0 }],
      },
      // Completed online pickup & delivery, paid by Paystack at booking (₦6,200).
      {
        customerPhone: AISHA,
        channel: "ONLINE",
        fulfilmentType: "PICKUP_DELIVERY",
        area: LEKKI,
        addressText: "7 Palm Grove Close, Lekki Phase 1, Lagos",
        createdHoursAgo: 18 * 24,
        pickup: { requestedInDays: 1, window: ["10:00", "12:00"], status: "CONFIRMED" },
        stages: [
          "BOOKED",
          "PICKUP_SCHEDULED",
          "PICKED_UP",
          "RECEIVED_BY_STORE",
          "IN_PROGRESS",
          "READY",
          "OUT_FOR_DELIVERY",
          "COMPLETED",
        ],
        revisions: [
          {
            lines: [{ service: "Shirt", quantity: "4" }, { service: "Trousers", quantity: "2" }],
            status: "APPROVED",
            approvedBy: "CUSTOMER",
          },
        ],
        payments: [
          { amount: 620_000, source: "ONLINE", method: "PAYSTACK", atStep: 0, payerEmail: "aisha.bello@example.com" },
        ],
      },
      // Cancelled before pickup; nothing was paid.
      {
        customerPhone: EMEKA,
        channel: "ONLINE",
        fulfilmentType: "PICKUP_DELIVERY",
        area: LEKKI,
        addressText: "22B Coral Reef Avenue, Lekki Phase 1, Lagos",
        createdHoursAgo: 9 * 24,
        payLater: true,
        pickup: { requestedInDays: 2, window: ["14:00", "16:00"], status: "REQUESTED" },
        stages: ["BOOKED", "CANCELLED"],
        revisions: [{ lines: [{ service: "Shirt", quantity: "6" }], status: "APPROVED", approvedBy: "CUSTOMER" }],
        cancelNote: "Customer is travelling this week and asked us to cancel by phone.",
      },
      // Out for delivery, paid online.
      {
        customerPhone: FUNMILAYO,
        channel: "ONLINE",
        fulfilmentType: "PICKUP_DELIVERY",
        area: LEKKI,
        addressText: "15 Sunrise Court, Lekki Phase 1, Lagos",
        createdHoursAgo: 7 * 24,
        pickup: { requestedInDays: 1, window: ["08:00", "10:00"], status: "CONFIRMED" },
        stages: ["BOOKED", "PICKUP_SCHEDULED", "PICKED_UP", "RECEIVED_BY_STORE", "IN_PROGRESS", "READY", "OUT_FOR_DELIVERY"],
        revisions: [
          {
            lines: [{ service: "Dress", quantity: "2" }, { service: "Bedding", quantity: "1" }],
            status: "APPROVED",
            approvedBy: "CUSTOMER",
          },
        ],
        payments: [
          { amount: 650_000, source: "ONLINE", method: "PAYSTACK", atStep: 0, payerEmail: "funmi.ogunleye@example.com" },
        ],
      },
      // Refund owed: paid ₦6,100 by POS, then revised down to ₦4,600 and approved.
      {
        customerPhone: NGOZI,
        channel: "COUNTER",
        fulfilmentType: "DROP_OFF",
        createdHoursAgo: 6 * 24,
        stages: ["RECEIVED_BY_STORE", "IN_PROGRESS", "READY"],
        revisions: [
          {
            lines: [{ service: "Dress", quantity: "3" }, { service: "Shirt", quantity: "2" }],
            status: "SUPERSEDED",
            approvedBy: "STAFF",
          },
          {
            lines: [{ service: "Dress", quantity: "2" }, { service: "Shirt", quantity: "2" }],
            status: "APPROVED",
            approvedBy: "CUSTOMER",
            reason: "Customer took one dress back before cleaning.",
            atStep: 1,
          },
        ],
        payments: [{ amount: 610_000, source: "STORE_COLLECTED", method: "POS", atStep: 0 }],
      },
      // Weighed, quote approved and paid online, now being washed.
      {
        customerPhone: TUNDE,
        channel: "ONLINE",
        fulfilmentType: "DROP_OFF",
        createdHoursAgo: 5 * 24,
        stages: ["BOOKED", "RECEIVED_BY_STORE", "QUOTE_AWAITING_APPROVAL", "RECEIVED_BY_STORE", "IN_PROGRESS"],
        revisions: [
          { lines: [{ service: "Laundry by weight", estimate: "3" }], status: "SUPERSEDED" },
          {
            lines: [{ service: "Laundry by weight", estimate: "3", quantity: "3.5" }],
            status: "APPROVED",
            approvedBy: "CUSTOMER",
            reason: "Weighed at the store: 3.5 kg.",
            atStep: 2,
          },
        ],
        payments: [
          { amount: 525_000, source: "ONLINE", method: "PAYSTACK", atStep: 3, payerEmail: "tunde.adeyemi@example.com" },
        ],
      },
      // In progress with "Others" lines; part paid by bank transfer, balance outstanding.
      {
        customerPhone: HALIMA,
        channel: "COUNTER",
        fulfilmentType: "DROP_OFF",
        createdHoursAgo: 4 * 24,
        stages: ["RECEIVED_BY_STORE", "IN_PROGRESS"],
        revisions: [
          {
            lines: [
              { service: "Bedding", quantity: "2" },
              { service: "Shirt", quantity: "3" },
              { adjustment: "Stain treatment on two white shirts", amount: 50_000 },
              { adjustment: "Returning customer discount", amount: -30_000 },
            ],
            status: "APPROVED",
            approvedBy: "STAFF",
          },
        ],
        payments: [{ amount: 400_000, source: "STORE_COLLECTED", method: "BANK_TRANSFER", atStep: 0 }],
        internalNote: "Customer will pay the balance on collection.",
      },
      // Weighed at 7.4 kg (estimate 5 kg); priced quote waiting for the customer.
      {
        customerPhone: IBRAHIM,
        channel: "COUNTER",
        fulfilmentType: "DROP_OFF",
        createdHoursAgo: 3 * 24,
        stages: ["RECEIVED_BY_STORE", "QUOTE_AWAITING_APPROVAL"],
        revisions: [
          {
            lines: [{ service: "Laundry by weight", estimate: "5" }, { service: "Shirt", quantity: "2" }],
            status: "PENDING",
          },
          {
            lines: [{ service: "Laundry by weight", estimate: "5", quantity: "7.4" }, { service: "Shirt", quantity: "2" }],
            status: "PENDING",
            reason: "Weighed at the store: 7.4 kg (estimate was 5 kg).",
            atStep: 1,
          },
        ],
      },
      // Returning customer by phone; store proposed a later window, customer accepted.
      {
        customerPhone: CHINEDU,
        channel: "PHONE",
        fulfilmentType: "PICKUP_DELIVERY",
        area: LEKKI,
        addressText: "3 Marina View Close, Lekki Phase 1, Lagos",
        createdHoursAgo: 2 * 24,
        payLater: true,
        pickup: { requestedInDays: 1, window: ["08:00", "10:00"], status: "CONFIRMED", scheduledWindow: ["14:00", "16:00"] },
        stages: ["BOOKED", "PICKUP_SCHEDULED", "PICKED_UP"],
        revisions: [
          {
            lines: [{ service: "Shirt", quantity: "5" }, { service: "Trousers", quantity: "3" }],
            status: "APPROVED",
            approvedBy: "STAFF",
          },
        ],
      },
      // Pay-later online booking with a UK number (no automatic SMS).
      {
        customerPhone: SEGUN,
        channel: "ONLINE",
        fulfilmentType: "PICKUP_DELIVERY",
        area: LEKKI,
        addressText: "9 Orchid Lane, Lekki Phase 1, Lagos",
        createdHoursAgo: 26,
        payLater: true,
        pickup: { requestedInDays: 2, window: ["10:00", "12:00"], status: "CONFIRMED" },
        stages: ["BOOKED", "PICKUP_SCHEDULED"],
        revisions: [
          {
            lines: [{ service: "Bedding", quantity: "1" }, { service: "Dress", quantity: "1" }],
            status: "APPROVED",
            approvedBy: "CUSTOMER",
          },
        ],
      },
      // Dropped off this morning; waiting to be weighed.
      {
        customerPhone: AISHA,
        channel: "ONLINE",
        fulfilmentType: "DROP_OFF",
        createdHoursAgo: 7,
        stages: ["BOOKED", "RECEIVED_BY_STORE"],
        revisions: [
          {
            lines: [{ service: "Laundry by weight", estimate: "6" }, { service: "Dress", quantity: "1" }],
            status: "PENDING",
          },
        ],
      },
      // New booking in a quote-required area; the link SMS failed ("SMS not sent – resend").
      {
        customerPhone: EMEKA,
        channel: "ONLINE",
        fulfilmentType: "PICKUP_DELIVERY",
        area: AJAH,
        addressText: "4 Lagoon View Street, Ajah, Lagos",
        createdHoursAgo: 2,
        pickup: { requestedInDays: 1, window: ["12:00", "14:00"], status: "REQUESTED" },
        stages: ["BOOKED"],
        revisions: [
          {
            lines: [{ service: "Shirt", quantity: "5" }, { service: "Trousers", quantity: "2" }],
            status: "PENDING",
          },
        ],
        linkSmsFailed: true,
      },
    ],
  };
}
