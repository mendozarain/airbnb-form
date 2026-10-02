import { BarChart3, CalendarDays, ClipboardList, Home, LogOut, Settings } from "lucide-react";
import { Link, Navigate, Outlet, useLocation } from "react-router-dom";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { LoadingBlock } from "@/components/ui/loading";
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
      <div className="grid min-h-screen place-items-center">
        <LoadingBlock label="Checking your session…" />
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
    <div className="min-h-screen bg-surface">
      <header className="sticky top-0 z-30 bg-surface/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6 lg:h-20 lg:px-8">
          <Link to="/admin" className="flex min-w-0 shrink-0 items-center gap-3 lg:mr-4">
            <span className="size-3.5 shrink-0 rounded-full bg-yellow" aria-hidden="true" />
            <span className="min-w-0">
              <span className="block truncate text-heading-s text-ink">Cozy Davao D-714</span>
              <span className="block truncate text-sm leading-4 text-ink-muted">Operations</span>
            </span>
          </Link>

          <nav className="hidden flex-1 items-center justify-center lg:flex" aria-label="Main">
            <div className="flex items-center gap-1 rounded-full bg-surface-raised p-1.5">
              {navigation.map((item) => {
                const active = isActive(item, location.pathname);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex h-11 items-center gap-2 rounded-full px-5 text-base font-medium text-ink-muted transition-colors hover:text-ink",
                      active && "bg-primary text-on-primary hover:text-on-primary"
                    )}
                  >
                    <Icon className="size-4" strokeWidth={1.75} />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </nav>

          <div className="ml-auto lg:ml-4">
            <Button variant="secondary" size="sm" aria-label="Sign out" onClick={signOut}>
              <LogOut className="size-4" />
              <span className="hidden lg:inline">Sign out</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-5 pb-32 sm:px-6 lg:px-8 lg:py-8 lg:pb-8">
        <Outlet />
      </main>

      <nav
        aria-label="Main"
        className="fixed inset-x-3 bottom-[max(.75rem,env(safe-area-inset-bottom))] z-30 grid grid-cols-5 gap-1 rounded-full bg-surface-raised p-1.5 shadow-float lg:hidden"
      >
        {navigation.map((item) => {
          const active = isActive(item, location.pathname);
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-w-0 flex-col items-center gap-0.5 rounded-full px-1 py-2 text-[11px] font-medium text-ink-muted transition-colors",
                active && "bg-primary text-on-primary"
              )}
            >
              <Icon className="size-[18px]" strokeWidth={1.75} />
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
