import { StoreIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/EmptyState";

// An unknown slug or a Deactivated store: nothing about the store is shown.
export default function StoreNotFound() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-page py-section">
      <title>Store not available</title>
      <EmptyState
        icon={StoreIcon}
        title="This store isn't available"
        description="Check the link you were given, or contact the store."
      />
    </main>
  );
}
