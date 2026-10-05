"use client";

import { MenuIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

import { SidebarContent } from "./SidebarContent";
import type { WorkspaceMember } from "./types";

// Below lg: a menu button that opens the sidebar in a sheet.
export function MobileNav({ member }: { member: WorkspaceMember }) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="-ml-2 lg:hidden" aria-label="Open navigation">
          <MenuIcon aria-hidden />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 gap-0 bg-card p-0">
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <SheetDescription className="sr-only">Pages in the {member.storeName} workspace</SheetDescription>
        <SidebarContent member={member} onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
