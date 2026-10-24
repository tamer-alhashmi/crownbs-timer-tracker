import { getOwnerBillingUsage } from "@/lib/ownerBilling";
import { OwnerBillingTrigger } from "./OwnerBillingTrigger";

export function OwnerBillingSkeleton() {
  return (
    <div aria-label="Loading current month billing" className="h-10 w-28 animate-pulse rounded-xl bg-slate-200" />
  );
}

export async function OwnerBillingWidget({ ownerId }: { ownerId: string }) {
  const usage = await getOwnerBillingUsage(ownerId);
  return <OwnerBillingTrigger usage={usage} />;
}
