"use client";

import { ChevronDownIcon, LogOutIcon, MoonIcon, SlidersHorizontalIcon, SunIcon } from "lucide-react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { useTransition } from "react";

import { signOut } from "@/actions/auth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getInitials } from "@/lib/names";

import { ROLE_LABELS, SETTINGS_PATH } from "./nav-items";
import type { WorkspaceMember } from "./types";

export function UserMenu({ member }: { member: WorkspaceMember }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [signingOut, startSignOut] = useTransition();
  const roleLabel = ROLE_LABELS[member.role];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-11 gap-2 px-1.5 sm:pr-2" aria-label={`Account menu for ${member.userName}`}>
          <Avatar>
            <AvatarFallback className="bg-accent text-xs font-semibold text-accent-foreground">
              {getInitials(member.userName)}
            </AvatarFallback>
          </Avatar>
          <span className="hidden min-w-0 flex-col items-start text-left sm:flex">
            <span className="type-label max-w-40 truncate text-foreground">{member.userName}</span>
            <span className="type-caption text-muted-foreground">{roleLabel}</span>
          </span>
          <ChevronDownIcon className="hidden text-muted-foreground sm:block" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <div className="flex flex-col gap-0.5 px-2 py-2">
          <p className="type-label truncate text-foreground">{member.userName}</p>
          <p className="type-caption truncate text-muted-foreground">{member.userEmail}</p>
          <p className="type-caption truncate text-primary dark:text-accent-foreground">
            {roleLabel} · {member.storeName}
          </p>
        </div>
        <DropdownMenuSeparator />
        {member.role === "OWNER" && (
          <DropdownMenuItem asChild className="h-10">
            <Link href={SETTINGS_PATH}>
              <SlidersHorizontalIcon aria-hidden />
              Store settings
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuGroup>
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={resolvedTheme} onValueChange={setTheme}>
            <DropdownMenuRadioItem value="light" className="h-10">
              <SunIcon aria-hidden />
              Light
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark" className="h-10">
              <MoonIcon aria-hidden />
              Dark
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          className="h-10"
          disabled={signingOut}
          onSelect={() => startSignOut(() => signOut())}
        >
          <LogOutIcon aria-hidden />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
