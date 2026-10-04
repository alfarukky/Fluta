import { LogOutIcon } from "lucide-react";

import { signOut } from "@/actions/auth";
import { Button } from "@/components/ui/button";

export function SignOutButton() {
  return (
    <form action={signOut}>
      <Button type="submit" variant="outline">
        <LogOutIcon data-icon="inline-start" aria-hidden />
        Sign out
      </Button>
    </form>
  );
}
