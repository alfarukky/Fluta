import {
  ArrowUpRightIcon,
  BellIcon,
  CalendarIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleCheckIcon,
  ClockIcon,
  CreditCardIcon,
  HouseIcon,
  Loader2Icon,
  LogOutIcon,
  MessageCircleIcon,
  PackageIcon,
  PhoneIcon,
  PlusIcon,
  PrinterIcon,
  ReceiptIcon,
  RepeatIcon,
  SearchIcon,
  SettingsIcon,
  ShirtIcon,
  ShoppingBasketIcon,
  Trash2Icon,
  TruckIcon,
  UserIcon,
  UsersIcon,
  WalletIcon,
  type LucideIcon,
} from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { EmptyState } from "@/components/shared/EmptyState";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { InputWithPrefix } from "@/components/ui/input-with-prefix";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DEFAULT_TIME_ZONE, getLocalDateKey } from "@/lib/time";
import { SAMPLE_STORE, type BadgeTone } from "./sample-data";
import { ShowcaseGroup, ShowcaseSection } from "./ShowcaseSection";
import { PickerDemo } from "./PickerDemo";
import { ToastDemo, type ToastSample } from "./ToastDemo";

const BUTTON_VARIANTS = [
  "primary",
  "secondary",
  "outline",
  "ghost",
  "destructive",
  "subtle",
  "subtle-destructive",
] as const;

const BADGE_TONES: BadgeTone[] = ["neutral", "success", "warning", "error", "info"];

const TOAST_SAMPLES: ToastSample[] = [
  {
    kind: "success",
    label: "Success",
    title: "Order FF-1048 moved to Ready",
    description: "The customer will get an SMS shortly.",
  },
  { kind: "info", label: "Info", title: "Quote sent to Chioma Eze" },
  {
    kind: "warning",
    label: "Warning",
    title: "Pickup window awaiting confirmation",
    description: "FF-1046 · Requested 10:00–12:00",
  },
  {
    kind: "error",
    label: "Error",
    title: "SMS not sent",
    description: "Check the number and resend the tracking link.",
  },
];

interface IconSample {
  name: string;
  icon: LucideIcon;
}

const ICONS: IconSample[] = [
  { name: "House", icon: HouseIcon },
  { name: "ShoppingBasket", icon: ShoppingBasketIcon },
  { name: "Shirt", icon: ShirtIcon },
  { name: "Package", icon: PackageIcon },
  { name: "Truck", icon: TruckIcon },
  { name: "Clock", icon: ClockIcon },
  { name: "Calendar", icon: CalendarIcon },
  { name: "CircleCheck", icon: CircleCheckIcon },
  { name: "Receipt", icon: ReceiptIcon },
  { name: "CreditCard", icon: CreditCardIcon },
  { name: "Wallet", icon: WalletIcon },
  { name: "Users", icon: UsersIcon },
  { name: "Phone", icon: PhoneIcon },
  { name: "MessageCircle", icon: MessageCircleIcon },
  { name: "Bell", icon: BellIcon },
  { name: "Search", icon: SearchIcon },
  { name: "Printer", icon: PrinterIcon },
  { name: "Repeat", icon: RepeatIcon },
  { name: "Settings", icon: SettingsIcon },
  { name: "User", icon: UserIcon },
];

export function ButtonsSection() {
  return (
    <ShowcaseSection
      id="buttons"
      title="Buttons"
      description="One primary action per screen; everything else stays quiet. Default and icon sizes are 44px tall to meet the touch-target minimum."
    >
      <div className="flex flex-col gap-8">
        <ShowcaseGroup title="Variants">
          <div className="flex flex-wrap gap-component">
            {BUTTON_VARIANTS.map((variant) => (
              <Button key={variant} variant={variant} className="capitalize">
                {variant.replace("-", " ")}
              </Button>
            ))}
            <Button variant="link">Link</Button>
          </div>
        </ShowcaseGroup>
        <ShowcaseGroup title="Disabled">
          <div className="flex flex-wrap gap-component">
            {BUTTON_VARIANTS.map((variant) => (
              <Button key={variant} variant={variant} disabled className="capitalize">
                {variant.replace("-", " ")}
              </Button>
            ))}
          </div>
        </ShowcaseGroup>
        <ShowcaseGroup title="Row actions (table rows and list cards)">
          <div className="flex flex-col gap-component">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="subtle" size="sm">
                Edit
              </Button>
              <Button variant="subtle-destructive" size="sm">
                Disable
              </Button>
              <Button variant="subtle" size="sm">
                Enable
              </Button>
            </div>
            <p className="type-caption max-w-xl text-muted-foreground">
              Subtle at rest so a row of them stays calm, with a stronger hover and a full-strength focus ring.
              Status changes such as Disable turn to the error tone on hover. Small (36px) in desktop table rows;
              default size (44px) on mobile cards.
            </p>
          </div>
        </ShowcaseGroup>
        <ShowcaseGroup title="Sizes, icons and loading">
          <div className="flex flex-wrap items-center gap-component">
            <Button size="sm">Small</Button>
            <Button>Default</Button>
            <Button size="lg">Large</Button>
            <Button>
              <PlusIcon data-icon="inline-start" aria-hidden />
              Book a service
            </Button>
            <Button variant="outline">
              View order
              <ArrowUpRightIcon data-icon="inline-end" aria-hidden />
            </Button>
            <Button disabled>
              <Loader2Icon className="animate-spin" data-icon="inline-start" aria-hidden />
              Saving…
            </Button>
            <Button variant="outline" size="icon" aria-label="Notifications">
              <BellIcon aria-hidden />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Delete line">
              <Trash2Icon aria-hidden />
            </Button>
          </div>
        </ShowcaseGroup>
      </div>
    </ShowcaseSection>
  );
}

export function InputsSection() {
  return (
    <ShowcaseSection
      id="inputs"
      title="Inputs and labels"
      description="Every field has a visible label. Errors use aria-invalid and are linked with aria-describedby. Inputs use 16px text on mobile so phones don't zoom in."
    >
      <div className="grid max-w-3xl grid-cols-1 gap-form md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="ds-name">Customer name</Label>
          <Input id="ds-name" placeholder="Tunde Adebayo" autoComplete="off" />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="ds-phone">Phone number</Label>
          <Input
            id="ds-phone"
            type="tel"
            placeholder="+234 803 000 0000"
            aria-describedby="ds-phone-hint"
            autoComplete="off"
          />
          <p id="ds-phone-hint" className="type-caption text-muted-foreground">
            We text the order link to this number.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="ds-email">Email (optional)</Label>
          <Input
            id="ds-email"
            type="email"
            defaultValue="tunde@example"
            aria-invalid
            aria-describedby="ds-email-error"
            autoComplete="off"
          />
          <p id="ds-email-error" className="type-caption text-error">
            Enter a full email address, like tunde@example.com.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="ds-prefix">Order prefix</Label>
          <Input id="ds-prefix" defaultValue="FF" disabled />
          <p className="type-caption text-muted-foreground">
            Set by Fluta during onboarding.
          </p>
        </div>
        <div className="flex flex-col gap-2 md:col-span-2">
          <Label htmlFor="ds-search">Search orders</Label>
          <div className="relative">
            <SearchIcon
              className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              id="ds-search"
              type="search"
              placeholder="Order number or customer"
              className="pl-10"
            />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="ds-price">Price</Label>
          <InputWithPrefix id="ds-price" prefix="₦" defaultValue="1,500" inputMode="decimal" autoComplete="off" />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="ds-link">Store link</Label>
          <InputWithPrefix
            id="ds-link"
            prefix="fluta.app/store/"
            prefixClassName="hidden xs:flex"
            defaultValue="freshfold-laundry"
            readOnly
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="ds-category">Category</Label>
          <Select defaultValue="wash-iron">
            <SelectTrigger id="ds-category" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectItem value="all">All categories</SelectItem>
              <SelectItem value="wash-iron">Wash &amp; iron</SelectItem>
              <SelectItem value="wash-fold">Wash &amp; fold</SelectItem>
              <SelectItem value="household">Household</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <PickerDemo
          dateLabel="Closed date"
          timeLabel="Opening time"
          today={getLocalDateKey(new Date(), DEFAULT_TIME_ZONE)}
        />
        <div className="flex items-start justify-between gap-component rounded-lg border border-border p-3">
          <div className="flex flex-col gap-0.5">
            <Label htmlFor="ds-quote">Quote required</Label>
            <p id="ds-quote-hint" className="type-caption text-muted-foreground">
              Staff confirm the final price after inspection.
            </p>
          </div>
          <Switch id="ds-quote" defaultChecked aria-describedby="ds-quote-hint" className="mt-1" />
        </div>
        <fieldset className="flex flex-col gap-2 md:col-span-2">
          <legend className="type-label mb-2 text-foreground">Pricing</legend>
          <RadioGroup defaultValue="per-item" className="gap-2 md:grid-cols-3">
            {[
              { value: "per-item", label: "Per item", hint: "Each piece, like a shirt." },
              { value: "per-kg", label: "Per kg", hint: "Weighed at the store." },
              { value: "per-package", label: "Per package", hint: "A fixed bundle." },
            ].map((option) => (
              <Label
                key={option.value}
                htmlFor={`ds-pricing-${option.value}`}
                className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border p-3 has-data-checked:border-primary has-data-checked:bg-accent/40"
              >
                <RadioGroupItem id={`ds-pricing-${option.value}`} value={option.value} className="mt-0.5" />
                <span className="flex flex-col gap-0.5">
                  <span className="type-label text-foreground">{option.label}</span>
                  <span className="type-caption font-normal text-muted-foreground">{option.hint}</span>
                </span>
              </Label>
            ))}
          </RadioGroup>
        </fieldset>
      </div>
    </ShowcaseSection>
  );
}

export function BadgesSection() {
  return (
    <ShowcaseSection
      id="badges"
      title="Badges"
      description="Status is never shown by colour alone: every badge has a text label. The dot is decorative."
    >
      <div className="flex flex-col gap-8">
        <ShowcaseGroup title="Variants">
          <div className="flex flex-wrap gap-component">
            {BADGE_TONES.map((tone) => (
              <Badge key={tone} variant={tone} className="capitalize">
                {tone}
              </Badge>
            ))}
          </div>
        </ShowcaseGroup>
        <ShowcaseGroup title="In context (stage and payment shown separately)">
          <div className="flex flex-wrap gap-component">
            <Badge variant="info" dot>In progress</Badge>
            <Badge variant="warning" dot>Quote awaiting approval</Badge>
            <Badge variant="success" dot>Ready</Badge>
            <Badge variant="neutral" dot>Completed</Badge>
            <Badge variant="success">Paid</Badge>
            <Badge variant="warning">Outstanding</Badge>
            <Badge variant="error">Refund owed</Badge>
          </div>
        </ShowcaseGroup>
      </div>
    </ShowcaseSection>
  );
}

export function CardsSection() {
  return (
    <ShowcaseSection
      id="cards"
      title="Cards, avatars and separators"
      description="Cards are bordered, not shadowed. Card padding follows the card spacing token."
    >
      <div className="grid gap-grid md:grid-cols-2">
        <Card>
          <CardHeader className="border-b">
            <CardTitle>Customer</CardTitle>
            <CardDescription>Contact details for this order</CardDescription>
            <CardAction>
              <Button variant="ghost" size="icon-sm" aria-label="Call customer">
                <PhoneIcon aria-hidden />
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="flex items-center gap-3">
            <Avatar size="lg">
              <AvatarFallback className="bg-accent text-accent-foreground">
                TA
              </AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-col">
              <span className="type-label truncate">Tunde Adebayo</span>
              <span className="type-caption text-muted-foreground">
                +234 803 000 4521 · 6 orders
              </span>
            </div>
          </CardContent>
          <CardFooter className="gap-component">
            <Button variant="outline" size="sm">
              <RepeatIcon data-icon="inline-start" aria-hidden />
              Repeat order
            </Button>
          </CardFooter>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Fluta logo</CardTitle>
            <CardDescription>
              Text placeholder until the final asset exists.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end gap-6">
              <Logo size="sm" />
              <Logo />
              <Logo size="lg" />
            </div>
            <Separator />
            <div className="flex items-center gap-3">
              <Avatar>
                <AvatarFallback>{SAMPLE_STORE.owner.initials}</AvatarFallback>
              </Avatar>
              <Avatar size="sm">
                <AvatarFallback>CE</AvatarFallback>
              </Avatar>
              <Separator orientation="vertical" className="h-6!" />
              <span className="type-caption text-muted-foreground">
                Avatars fall back to initials
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    </ShowcaseSection>
  );
}

export function TabsSection() {
  return (
    <ShowcaseSection
      id="tabs"
      title="Tabs"
      description="Arrow keys move between tabs; the active panel is linked to its tab for screen readers."
    >
      <Tabs defaultValue="today" className="max-w-md">
        <TabsList>
          <TabsTrigger value="today">Today</TabsTrigger>
          <TabsTrigger value="month">This month</TabsTrigger>
        </TabsList>
        <TabsContent value="today" className="rounded-xl border border-border bg-card p-card">
          <p className="type-caption text-muted-foreground">Order value</p>
          <p className="type-h1">₦48,600</p>
        </TabsContent>
        <TabsContent value="month" className="rounded-xl border border-border bg-card p-card">
          <p className="type-caption text-muted-foreground">Order value</p>
          <p className="type-h1">₦1,284,500</p>
        </TabsContent>
      </Tabs>
    </ShowcaseSection>
  );
}

export function OverlaysSection() {
  return (
    <ShowcaseSection
      id="overlays"
      title="Dialogs, sheets and menus"
      description="Focus moves into the layer when it opens, stays trapped while open, and returns to the trigger on close. Escape closes it."
    >
      <div className="flex flex-wrap gap-component">
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline">Open dialog</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Cancel order FF-1047?</DialogTitle>
              <DialogDescription>
                The order and its payment history are kept. Add a note so the
                team knows why.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2">
              <Label htmlFor="ds-cancel-note">Note</Label>
              <Input id="ds-cancel-note" placeholder="Customer asked to cancel" />
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Keep order</Button>
              </DialogClose>
              <DialogClose asChild>
                <Button variant="destructive">Cancel order</Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline">Open side sheet</Button>
          </SheetTrigger>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Edit service</SheetTitle>
              <SheetDescription>Changes apply to new orders only.</SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-form px-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="ds-service-name">Name</Label>
                <Input id="ds-service-name" defaultValue="Shirt" />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="ds-service-price">Price per item (₦)</Label>
                <Input id="ds-service-price" inputMode="numeric" defaultValue="800" />
              </div>
            </div>
            <SheetFooter>
              <SheetClose asChild>
                <Button>Save service</Button>
              </SheetClose>
            </SheetFooter>
          </SheetContent>
        </Sheet>

        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline">Open bottom sheet</Button>
          </SheetTrigger>
          <SheetContent side="bottom">
            <SheetHeader>
              <SheetTitle>Move FF-1048 to Ready?</SheetTitle>
              <SheetDescription>
                Tunde gets an SMS that the order is ready.
              </SheetDescription>
            </SheetHeader>
            <SheetFooter>
              <SheetClose asChild>
                <Button>
                  <CheckIcon data-icon="inline-start" aria-hidden />
                  Mark as ready
                </Button>
              </SheetClose>
            </SheetFooter>
          </SheetContent>
        </Sheet>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">
              {SAMPLE_STORE.owner.name}
              <ChevronDownIcon data-icon="inline-end" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>{SAMPLE_STORE.name}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <UserIcon aria-hidden />
              Profile
            </DropdownMenuItem>
            <DropdownMenuItem>
              <SettingsIcon aria-hidden />
              Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <LogOutIcon aria-hidden />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </ShowcaseSection>
  );
}

export function FeedbackSection() {
  return (
    <ShowcaseSection
      id="feedback"
      title="Loading, toasts and empty states"
      description="Every screen has loading, empty, error and success states. Skeletons keep the layout steady while content loads."
    >
      <div className="grid gap-grid md:grid-cols-2">
        <ShowcaseGroup title="Skeleton">
          <div
            role="status"
            aria-label="Loading order"
            className="flex flex-col gap-4 rounded-xl border border-border bg-card p-card"
          >
            <div className="flex items-center gap-3">
              <Skeleton className="size-11 rounded-lg" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-component">
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </div>
          </div>
        </ShowcaseGroup>
        <ShowcaseGroup title="Empty state">
          <EmptyState
            icon={ShoppingBasketIcon}
            title="No orders yet"
            description="Orders from your booking link and the counter will appear here. Share your booking link to get started."
            action={
              <Button variant="secondary">
                <PlusIcon data-icon="inline-start" aria-hidden />
                New order
              </Button>
            }
          />
        </ShowcaseGroup>
        <ShowcaseGroup title="Toasts" className="md:col-span-2">
          <ToastDemo samples={TOAST_SAMPLES} />
        </ShowcaseGroup>
      </div>
    </ShowcaseSection>
  );
}

export function IconsSection() {
  return (
    <ShowcaseSection
      id="icons"
      title="Icons"
      description="Lucide is the only icon library. Decorative icons are aria-hidden; icon-only buttons always have an aria-label."
    >
      <ul className="grid grid-cols-2 gap-component xs:grid-cols-3 md:grid-cols-5">
        {ICONS.map(({ name, icon: Icon }) => (
          <li
            key={name}
            className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5"
          >
            <Icon className="size-5 text-primary" aria-hidden />
            <span className="type-caption truncate">{name}</span>
          </li>
        ))}
      </ul>
    </ShowcaseSection>
  );
}
