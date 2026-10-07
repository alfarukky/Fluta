import {
  ArrowRightIcon,
  ArrowUpRightIcon,
  BellIcon,
  CheckIcon,
  CircleAlertIcon,
  ClockIcon,
  ReceiptIcon,
  ShirtIcon,
  TruckIcon,
} from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  SAMPLE_ATTENTION,
  SAMPLE_ORDERS,
  SAMPLE_STAGE_COUNTS,
  SAMPLE_STORE,
  SAMPLE_SUMMARIES,
  SAMPLE_TIMELINE,
  type SampleOrder,
  type SampleTimelineStep,
} from "./sample-data";
import { ShowcaseGroup, ShowcaseSection } from "./ShowcaseSection";

interface OrderProps {
  order: SampleOrder;
}

interface TimelineStepProps {
  step: SampleTimelineStep;
}

const TIMELINE_DOT: Record<SampleTimelineStep["state"], string> = {
  done: "bg-primary text-primary-foreground",
  current: "border-2 border-primary bg-card",
  upcoming: "border-2 border-border bg-card",
};

const TIMELINE_STATE_LABEL: Record<SampleTimelineStep["state"], string> = {
  done: "Done",
  current: "Current step",
  upcoming: "Upcoming",
};

function WorkspaceTopBar() {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border bg-card px-card py-3">
      <div className="flex min-w-0 flex-col">
        <span className="type-caption text-muted-foreground">
          {SAMPLE_STORE.today}
        </span>
        <span className="type-h3 truncate">{SAMPLE_STORE.name}</span>
      </div>
      <div className="flex items-center gap-component">
        <Button variant="outline" size="icon" aria-label="Notifications">
          <BellIcon aria-hidden />
        </Button>
        <Avatar>
          <AvatarFallback className="bg-accent text-accent-foreground">
            {SAMPLE_STORE.owner.initials}
          </AvatarFallback>
        </Avatar>
      </div>
    </div>
  );
}

function AttentionCard() {
  return (
    <Card className="border-warning/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CircleAlertIcon className="size-5 text-warning" aria-hidden />
          Attention required
        </CardTitle>
        <CardDescription>Things waiting on you or your customers</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y divide-border">
          {SAMPLE_ATTENTION.map((item) => (
            <li key={item.label}>
              <a
                href="#compositions"
                className="flex min-h-11 items-center gap-3 rounded-md py-2 outline-none hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <span className="type-h3 w-6 text-right">{item.count}</span>
                <span className="type-body-sm flex-1">{item.label}</span>
                <ArrowRightIcon className="size-4 text-muted-foreground" aria-hidden />
              </a>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function StageSummary() {
  return (
    <ul
      aria-label="Orders by stage"
      className="grid grid-cols-2 gap-component xs:grid-cols-3 md:grid-cols-5"
    >
      {SAMPLE_STAGE_COUNTS.map((item) => (
        <li
          key={item.stage}
          className="flex flex-col gap-0.5 rounded-lg border border-border bg-card px-3 py-2.5"
        >
          <span className="type-h2">{item.count}</span>
          <span className="type-caption text-muted-foreground">{item.stage}</span>
        </li>
      ))}
    </ul>
  );
}

function FinancialSummary() {
  return (
    <Tabs defaultValue="today">
      <div className="flex flex-wrap items-center justify-between gap-component">
        <h4 className="type-h3">Financial overview</h4>
        <TabsList>
          <TabsTrigger value="today">Today</TabsTrigger>
          <TabsTrigger value="month">This month</TabsTrigger>
        </TabsList>
      </div>
      {(["today", "month"] as const).map((period) => (
        <TabsContent key={period} value={period}>
          <dl className="grid grid-cols-1 gap-component xs:grid-cols-2 lg:grid-cols-4">
            {SAMPLE_SUMMARIES.map((summary) => (
              <div
                key={summary.label}
                className="flex flex-col gap-1 rounded-xl border border-border bg-card p-card"
              >
                <dt className="type-caption text-muted-foreground">{summary.label}</dt>
                <dd className="type-h2">{summary[period]}</dd>
              </div>
            ))}
          </dl>
        </TabsContent>
      ))}
    </Tabs>
  );
}

function OrderMobileCard({ order }: OrderProps) {
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-border bg-card p-card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="type-h3">{order.number}</span>
          <span className="type-body-sm">{order.customer}</span>
          <span className="type-caption text-muted-foreground">{order.created}</span>
        </div>
        <span className="type-h3 shrink-0">{order.total}</span>
      </div>
      <p className="type-body-sm text-muted-foreground">{order.services}</p>
      <div className="flex flex-wrap gap-component">
        <Badge variant={order.stage.tone} dot>
          {order.stage.label}
        </Badge>
        <Badge variant={order.payment.tone}>{order.payment.label}</Badge>
      </div>
    </li>
  );
}

function RecentOrders() {
  return (
    <Card className="gap-0 pb-0">
      <CardHeader className="border-b">
        <CardTitle>Recent orders</CardTitle>
        <CardDescription>Stacked cards on mobile, a table from tablet up</CardDescription>
        <CardAction>
          <Button variant="outline" size="sm">
            View all
          </Button>
        </CardAction>
      </CardHeader>
      <ul className="flex flex-col gap-component bg-muted/40 p-3 md:hidden">
        {SAMPLE_ORDERS.map((order) => (
          <OrderMobileCard key={order.number} order={order} />
        ))}
      </ul>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-card">Order</TableHead>
              <TableHead>Services</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead>Payment</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="pr-card text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {SAMPLE_ORDERS.map((order) => (
              <TableRow key={order.number}>
                <TableCell className="pl-card">
                  <div className="flex flex-col">
                    <span className="type-label">{order.number}</span>
                    <span className="type-caption text-muted-foreground">
                      {order.customer} · {order.created}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="max-w-56 truncate">{order.services}</TableCell>
                <TableCell>
                  <Badge variant={order.stage.tone} dot>
                    {order.stage.label}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={order.payment.tone}>{order.payment.label}</Badge>
                </TableCell>
                <TableCell className="type-label text-right">{order.total}</TableCell>
                <TableCell className="pr-card text-right">
                  <Button variant="subtle" size="sm" aria-label={`View order ${order.number}`}>
                    View
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

function ActiveOrderCard() {
  const steps = [
    { icon: CheckIcon, label: "Received by store", detail: "9:42 AM today", current: false },
    { icon: ClockIcon, label: "In progress", detail: "Being cleaned now", current: true },
    { icon: TruckIcon, label: "Out for delivery", detail: "Tomorrow, 4:00 PM", current: false },
  ];

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Active order</CardTitle>
        <CardDescription>Here&apos;s the latest on your laundry</CardDescription>
        <CardAction>
          <Badge variant="info" dot>
            In progress
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1 md:flex-row md:items-start md:gap-3">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
              <ShirtIcon className="size-5" aria-hidden />
            </span>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="type-label">Shirt × 4, Trousers × 2</span>
              <span className="type-caption text-muted-foreground">
                Order FF-1048 · Pickup & delivery
              </span>
            </div>
          </div>
          <Button variant="link" className="h-11 self-start px-0">
            View order
            <ArrowUpRightIcon data-icon="inline-end" aria-hidden />
          </Button>
        </div>
        <ol className="grid gap-component md:grid-cols-3">
          {steps.map(({ icon: Icon, label, detail, current }) => (
            <li
              key={label}
              aria-current={current ? "step" : undefined}
              className={cn(
                "flex flex-col gap-1 rounded-lg p-3",
                current ? "bg-accent text-accent-foreground" : "bg-muted",
              )}
            >
              <Icon className="size-4" aria-hidden />
              <span className="type-label">{label}</span>
              <span
                className={cn(
                  "type-caption",
                  current ? "text-accent-foreground" : "text-muted-foreground",
                )}
              >
                {detail}
              </span>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

function TimelineStep({ step }: TimelineStepProps) {
  return (
    <li
      aria-current={step.state === "current" ? "step" : undefined}
      className="group relative flex gap-3 pb-5 last:pb-0"
    >
      <span
        aria-hidden
        className="absolute top-6 bottom-0 left-[11px] w-px bg-border group-last:hidden"
      />
      <span
        aria-hidden
        className={cn(
          "relative flex size-6 shrink-0 items-center justify-center rounded-full",
          TIMELINE_DOT[step.state],
        )}
      >
        {step.state === "done" && <CheckIcon className="size-3.5" />}
        {step.state === "current" && <span className="size-2 rounded-full bg-primary" />}
      </span>
      <div className="flex flex-col">
        <span
          className={cn(
            "type-label",
            step.state === "upcoming" && "text-muted-foreground",
          )}
        >
          {step.label}
          <span className="sr-only"> ({TIMELINE_STATE_LABEL[step.state]})</span>
        </span>
        <span className="type-caption text-muted-foreground">{step.detail}</span>
      </div>
    </li>
  );
}

function MobileTrackingPreview() {
  return (
    <div className="mx-auto w-full max-w-[360px] overflow-hidden rounded-3xl border border-border bg-background">
      <div className="flex items-center justify-between border-b border-border bg-card px-4 py-3">
        <span className="type-h3">FreshFold Laundry</span>
        <Logo size="sm" className="opacity-70" />
      </div>
      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-1">
          <span className="type-caption text-muted-foreground">Order #FF-1047</span>
          <h4 className="type-h1">Quote awaiting approval</h4>
        </div>
        <div className="flex flex-col gap-3 rounded-xl border border-warning/30 bg-warning/8 p-4">
          <div className="flex flex-col gap-0.5">
            <span className="type-label">Your quote is ready</span>
            <span className="type-body-sm text-muted-foreground">
              The store weighed 3.5 kg of laundry. New total ₦5,250.
            </span>
          </div>
          <Button className="w-full">Review quote</Button>
        </div>
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="type-label">Payment</span>
            <span className="type-caption text-muted-foreground">
              Due after you approve the quote
            </span>
          </div>
          <ol aria-label="Order progress">
            {SAMPLE_TIMELINE.map((step) => (
              <TimelineStep key={step.label} step={step} />
            ))}
          </ol>
        </div>
        <Button variant="ghost" className="self-center">
          <ReceiptIcon data-icon="inline-start" aria-hidden />
          View receipt
        </Button>
      </div>
    </div>
  );
}

export function CompositionsSection() {
  return (
    <ShowcaseSection
      id="compositions"
      title="Product compositions"
      description="Static placeholder layouts that check how the foundation holds up when components are combined. All data is fictional FreshFold Laundry sample data; nothing here is wired to real functionality."
    >
      <div className="flex flex-col gap-section">
        <ShowcaseGroup title="Store workspace preview">
          <div className="overflow-hidden rounded-2xl border border-border bg-background">
            <WorkspaceTopBar />
            <div className="flex flex-col gap-grid p-3 md:p-card">
              <AttentionCard />
              <StageSummary />
              <FinancialSummary />
              <RecentOrders />
            </div>
          </div>
        </ShowcaseGroup>
        <div className="grid items-start gap-grid lg:grid-cols-[1fr_360px]">
          <ShowcaseGroup title="Order status card">
            <ActiveOrderCard />
          </ShowcaseGroup>
          <ShowcaseGroup title="Customer tracking page (mobile, 360px)">
            <MobileTrackingPreview />
          </ShowcaseGroup>
        </div>
      </div>
    </ShowcaseSection>
  );
}

const BREAKPOINTS = [
  { name: "Small mobile", range: "< 400px", className: "flex xs:hidden" },
  { name: "Large mobile", range: "400–767px", className: "hidden xs:flex md:hidden" },
  { name: "Tablet", range: "768–1023px", className: "hidden md:flex lg:hidden" },
  { name: "Desktop", range: "≥ 1024px", className: "hidden lg:flex" },
];

export function ResponsiveSection() {
  return (
    <ShowcaseSection
      id="responsive"
      title="Responsive behaviour"
      description="Mobile-first: base styles target a 360px phone, then xs (400px), md (768px) and lg (1024px) add layout. Resize the window to watch the grid and the active breakpoint change."
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-component">
          <span className="type-label">Current breakpoint:</span>
          {BREAKPOINTS.map((bp) => (
            <Badge key={bp.name} variant="info" className={bp.className}>
              {bp.name} · {bp.range}
            </Badge>
          ))}
        </div>
        <ShowcaseGroup title="Grid: 1 → 2 → 3 → 4 columns">
          <div className="grid grid-cols-1 gap-grid xs:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {["Booked", "Received by store", "In progress", "Ready"].map((label) => (
              <div
                key={label}
                className="flex h-20 items-center justify-center rounded-xl border border-border bg-card"
              >
                <span className="type-label">{label}</span>
              </div>
            ))}
          </div>
        </ShowcaseGroup>
      </div>
    </ShowcaseSection>
  );
}
