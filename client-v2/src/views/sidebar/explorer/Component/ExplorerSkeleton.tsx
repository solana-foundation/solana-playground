import { Skeleton } from "../../../../components/Loading";

const ExplorerSkeleton = () => (
  <div className="mx-2 mt-6 flex flex-col px-2">
    <div className="flex justify-between">
      <Skeleton height="1.625rem" width="4.25rem" />
      <Skeleton height="1.625rem" width="12.25rem" />
    </div>

    <div className="mt-2" />
    <Skeleton height="1.875rem" />

    <div className="mt-2" />
    <Skeleton height="1.75rem" width="8.5rem" style={{ marginLeft: "auto" }} />

    <div className="mt-3" />
    <div className="flex gap-2">
      <Skeleton height="1.75rem" width="3.75rem" />
      <Skeleton height="1.75rem" width="4.125rem" />
      <Skeleton height="1.75rem" width="4.875rem" />
    </div>

    <div className="mt-1" />
    <Skeleton height="3.25rem" />

    <div className="mt-3.5" />
    <div className="flex gap-2">
      <Skeleton height="1.75rem" width="3.125rem" />
      <Skeleton height="1.75rem" width="3.875rem" />
      <Skeleton height="1.75rem" width="3.625rem" />
    </div>

    <div className="mt-1" />
    <Skeleton height="3.25rem" />
  </div>
);

export default ExplorerSkeleton;
