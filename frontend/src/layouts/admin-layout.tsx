import { BarChart3, CalendarDays, ClipboardList, Home, LogOut, Settings } from "lucide-react";
import { Link, Navigate, Outlet, useLocation } from "react-router-dom";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const navigation = [
  { to: "/admin", label: "Overview", icon: Home, exact: true },
  { to: "/admin/calendar", label: "Calendar", icon: CalendarDays, exact: false },
  { to: "/admin/registrations", label: "Registrations", icon: ClipboardList, exact: false },
  { to: "/admin/pricing", label: "Pricing", icon: BarChart3, exact: false },
  { to: "/admin/settings", label: "Settings", icon: Settings, exact: false }
] as const;

export function AdminLayout() {
  const session = authClient.useSession();
  const location = useLocation();
  if (session.isPending)
    return (
      <div className="mx-auto max-w-7xl p-5">
        <Skeleton className="h-20 w-full" />
      </div>
    );
  if (!session.data) return <Navigate to="/sign-in" replace state={{ from: location.pathname }} />;

  return (
    <div className="min-h-screen bg-slate-50 lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="hidden border-r border-slate-200 bg-slate-950 text-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col">
        <Link to="/admin" className="border-b border-white/10 px-6 py-6">
          <p className="text-lg font-semibold tracking-tight">Cozy Davao</p>
          <p className="mt-1 text-xs text-slate-400">D-714 Operations</p>
        </Link>
        <nav className="flex-1 space-y-1 p-3">
          {navigation.map((item) => {
            const active = isActive(item, location.pathname);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-white/10 hover:text-white",
                  active && "bg-emerald-500/15 text-emerald-300"
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-white/10 p-3">
          <button
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-slate-400 transition hover:bg-white/10 hover:text-white"
            onClick={() =>
              authClient.signOut({
                fetchOptions: {
                  onSuccess: () => {
                    window.location.href = "/sign-in";
                  }
                }
              })
            }
          >
            <LogOut className="size-4" />
            Sign out
          </button>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur lg:hidden">
          <div className="flex h-16 items-center gap-3 px-4">
            <Link to="/admin" className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-950">Cozy Davao D-714</p>
              <p className="truncate text-xs text-slate-500">Operations</p>
            </Link>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Sign out"
              onClick={() =>
                authClient.signOut({
                  fetchOptions: {
                    onSuccess: () => {
                      window.location.href = "/sign-in";
                    }
                  }
                })
              }
            >
              <LogOut className="size-4" />
            </Button>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 py-6 pb-24 sm:px-6 lg:px-8 lg:py-8 lg:pb-8">
          <Outlet />
        </main>

        <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-slate-200 bg-white px-1 pb-[max(.35rem,env(safe-area-inset-bottom))] pt-1 lg:hidden">
          {navigation.map((item) => {
            const active = isActive(item, location.pathname);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex min-w-0 flex-col items-center gap-1 rounded-md px-1 py-2 text-[10px] font-medium text-slate-500",
                  active && "bg-emerald-50 text-emerald-700"
                )}
              >
                <Icon className="size-4" />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

function isActive(item: (typeof navigation)[number], pathname: string) {
  if (item.exact) return pathname === item.to;
  if (item.to === "/admin/registrations" && pathname.startsWith("/admin/bookings/")) return true;
  return pathname.startsWith(item.to);
}
