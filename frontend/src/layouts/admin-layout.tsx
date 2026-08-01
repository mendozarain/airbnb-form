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

  const signOut = () =>
    authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          window.location.href = "/sign-in";
        }
      }
    });

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6 lg:h-20 lg:px-8">
          <Link to="/admin" className="min-w-0 shrink-0 lg:mr-4">
            <p className="truncate text-sm font-semibold tracking-tight text-slate-950 lg:text-base">
              Cozy Davao D-714
            </p>
            <p className="truncate text-xs text-slate-500">Operations</p>
          </Link>

          <nav className="hidden flex-1 items-center justify-center lg:flex">
            <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">
              {navigation.map((item) => {
                const active = isActive(item, location.pathname);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={cn(
                      "flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium text-slate-600 transition hover:bg-white/70 hover:text-slate-950",
                      active && "bg-white text-emerald-700 shadow-sm ring-1 ring-slate-200"
                    )}
                  >
                    <Icon className="size-4" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </nav>

          <div className="ml-auto lg:ml-4">
            <Button
              variant="ghost"
              size="sm"
              aria-label="Sign out"
              onClick={signOut}
            >
              <LogOut className="size-4" />
              <span className="hidden lg:inline">Sign out</span>
            </Button>
          </div>
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
  );
}

function isActive(item: (typeof navigation)[number], pathname: string) {
  if (item.exact) return pathname === item.to;
  if (item.to === "/admin/registrations" && pathname.startsWith("/admin/bookings/")) return true;
  return pathname.startsWith(item.to);
}
