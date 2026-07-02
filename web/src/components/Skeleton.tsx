// Shimmer skeleton placeholders used while history pages load. The shimmer is a
// moving gradient (see the `shimmer` keyframes in index.css / tailwind config).

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-white/[0.07] ${className}`} />;
}

// MessageSkeleton mimics a chat message row (avatar + two text lines).
export function MessageSkeleton() {
  return (
    <div className="flex items-start gap-2 px-2 py-1.5">
      <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
      <div className="flex-1 space-y-1.5 py-0.5">
        <Skeleton className="h-2.5 w-24" />
        <Skeleton className="h-2.5 w-2/3" />
      </div>
    </div>
  );
}

// RowSkeleton mimics a feed/list card.
export function RowSkeleton() {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <div className="flex items-center gap-2">
        <Skeleton className="h-6 w-6 rounded-full" />
        <Skeleton className="h-2.5 w-32" />
      </div>
      <Skeleton className="mt-2 h-3 w-3/4" />
      <Skeleton className="mt-1.5 h-3 w-1/2" />
    </div>
  );
}

// LoadingOlder is the small centered spinner-row shown at the top of a chat pane
// while older messages are being fetched.
export function LoadingOlder() {
  return (
    <div className="py-1">
      <MessageSkeleton />
    </div>
  );
}
