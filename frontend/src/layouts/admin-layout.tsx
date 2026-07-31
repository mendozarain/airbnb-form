import { LogOut, Settings } from "lucide-react";
import { Link, Navigate, Outlet, useLocation } from "react-router-dom";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function AdminLayout() {
  const session = authClient.useSession();
  const location = useLocation();
  if (session.isPending)
    return (
      <div className="mx-auto max-w-6xl p-5">
        <Skeleton className="h-12 w-full" />
      </div>
    );
  if (!session.data) return <Navigate to="/sign-in" replace state={{ from: location.pathname }} />;

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Link to="/admin" className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-950">Cozy Davao D-714</p>
            <p className="truncate text-xs text-slate-500">Guest registrations</p>
          </Link>
          <nav className="flex items-center gap-1">
            <Button
              asChild
              variant="ghost"
              size="sm"
              className={cn(location.pathname === "/admin/settings" && "bg-slate-100")}
            >
              <Link to="/admin/settings">
                <Settings className="size-4" />
                <span className="hidden sm:inline">Settings</span>
              </Link>
            </Button>
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
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <Outlet />
      </main>
    </div>
  );
}
