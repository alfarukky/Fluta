// Static placeholder data for the /design-system showcase only. Amounts are
// pre-formatted display strings: money helpers belong to a later feature.

export type BadgeTone = "neutral" | "success" | "warning" | "error" | "info";

export interface SampleStatus {
  label: string;
  tone: BadgeTone;
}

export interface SampleOrder {
  number: string;
  customer: string;
  services: string;
  fulfilment: string;
  total: string;
  created: string;
  stage: SampleStatus;
  payment: SampleStatus;
}

export interface SampleAttentionItem {
  count: number;
  label: string;
}

export interface SampleStageCount {
  stage: string;
  count: number;
}

export interface SampleSummary {
  label: string;
  today: string;
  month: string;
}

export interface SampleTimelineStep {
  label: string;
  detail: string;
  state: "done" | "current" | "upcoming";
}

export const SAMPLE_STORE = {
  name: "FreshFold Laundry",
  address: "12 Admiralty Way, Lekki",
  today: "Friday, 2 October 2026",
  owner: { name: "Amaka Okafor", initials: "AO", email: "amaka@freshfold.example" },
};

export const SAMPLE_ORDERS: SampleOrder[] = [
  {
    number: "FF-1048",
    customer: "Tunde Adebayo",
    services: "Shirt × 4, Trousers × 2",
    fulfilment: "Pickup & delivery",
    total: "₦6,200",
    created: "Today, 9:42 AM",
    stage: { label: "In progress", tone: "info" },
    payment: { label: "Paid", tone: "success" },
  },
  {
    number: "FF-1047",
    customer: "Chioma Eze",
    services: "Laundry by weight · 3.5 kg",
    fulfilment: "Drop-off",
    total: "₦5,250",
    created: "Today, 8:15 AM",
    stage: { label: "Quote awaiting approval", tone: "warning" },
    payment: { label: "Not due yet", tone: "neutral" },
  },
  {
    number: "FF-1046",
    customer: "Ibrahim Musa",
    services: "Bedding × 1, Dress × 2",
    fulfilment: "Drop-off",
    total: "₦5,500",
    created: "Yesterday, 4:30 PM",
    stage: { label: "Ready", tone: "success" },
    payment: { label: "Outstanding", tone: "warning" },
  },
  {
    number: "FF-1045",
    customer: "Funke Oladipo",
    services: "Dress × 3",
    fulfilment: "Drop-off",
    total: "₦4,500",
    created: "Yesterday, 11:05 AM",
    stage: { label: "Completed", tone: "neutral" },
    payment: { label: "Refund owed", tone: "error" },
  },
];

export const SAMPLE_ATTENTION: SampleAttentionItem[] = [
  { count: 3, label: "quotes awaiting customer approval" },
  { count: 2, label: "payments outstanding" },
  { count: 1, label: "pickup window awaiting confirmation" },
  { count: 1, label: "refund owed" },
];

export const SAMPLE_STAGE_COUNTS: SampleStageCount[] = [
  { stage: "Booked", count: 4 },
  { stage: "Received by store", count: 6 },
  { stage: "In progress", count: 9 },
  { stage: "Ready", count: 5 },
  { stage: "Out for delivery", count: 2 },
];

export const SAMPLE_SUMMARIES: SampleSummary[] = [
  { label: "Order value", today: "₦48,600", month: "₦1,284,500" },
  { label: "Confirmed payments", today: "₦36,900", month: "₦1,102,300" },
  { label: "Outstanding balances", today: "₦21,750", month: "₦21,750" },
  { label: "Refunds owed", today: "₦1,500", month: "₦1,500" },
];

export const SAMPLE_TIMELINE: SampleTimelineStep[] = [
  { label: "Booked", detail: "2 Oct, 8:15 AM", state: "done" },
  { label: "Received by store", detail: "2 Oct, 9:05 AM", state: "done" },
  { label: "Quote awaiting approval", detail: "Waiting for you", state: "current" },
  { label: "In progress", detail: "After you approve", state: "upcoming" },
  { label: "Ready", detail: "We'll text you", state: "upcoming" },
  { label: "Completed", detail: "Collected from the store", state: "upcoming" },
];
