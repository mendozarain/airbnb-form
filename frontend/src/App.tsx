import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";

const AdminLayout = lazy(() =>
  import("@/layouts/admin-layout").then((module) => ({ default: module.AdminLayout }))
);
const DashboardPage = lazy(() =>
  import("@/pages/dashboard-page").then((module) => ({ default: module.DashboardPage }))
);
const GuestPage = lazy(() => import("@/pages/guest-page").then((module) => ({ default: module.GuestPage })));
const SettingsPage = lazy(() =>
  import("@/pages/settings-page").then((module) => ({ default: module.SettingsPage }))
);
const SignInPage = lazy(() =>
  import("@/pages/sign-in-page").then((module) => ({ default: module.SignInPage }))
);
const SubmissionPage = lazy(() =>
  import("@/pages/submission-page").then((module) => ({ default: module.SubmissionPage }))
);

export function App() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-6xl p-5">
          <Skeleton className="h-20 w-full" />
        </div>
      }
    >
      <Routes>
        <Route path="/sign-in" element={<SignInPage />} />
        <Route path="/invite/:token" element={<GuestPage />} />
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="submissions/:id" element={<SubmissionPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </Suspense>
  );
}
