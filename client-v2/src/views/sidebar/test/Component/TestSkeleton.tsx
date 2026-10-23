import { Skeleton } from "@/shared/ui/skeleton";

/** The form's outline while the page loads */
const TestSkeleton = () => (
  <div className="flex flex-col gap-4 p-6">
    <Skeleton className="h-4 w-40" />
    <Skeleton className="h-3 w-24" />
    <Skeleton className="h-12 w-full rounded-xl" />
    <Skeleton className="h-3 w-20" />
    <Skeleton className="h-12 w-full rounded-xl" />
  </div>
);

export default TestSkeleton;
