import type { ReactNode } from "react";

// `flush` makes the content area fill the window with no padding/scroll of its
// own — for apps that manage their own full-height layout (e.g. chat).
export function AppShell({
  title,
  subtitle,
  children,
  flush,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  flush?: boolean;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-white/5 px-4 py-2.5">
        <h1 className="text-sm font-bold text-white">{title}</h1>
        {subtitle && <p className="text-[11px] text-white/40">{subtitle}</p>}
      </div>
      <div data-app-content className={`relative ${flush ? "min-h-0 flex-1" : "flex-1 overflow-auto p-4"}`}>{children}</div>
    </div>
  );
}

export function Empty({ message }: { message: string }) {
  return <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6 text-center text-sm text-white/40">{message}</div>;
}
