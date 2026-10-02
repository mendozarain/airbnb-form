import { zodResolver } from "@hookform/resolvers/zod";
import { Lock, Mail } from "lucide-react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { IconField } from "@/components/ui/field";
import { authClient } from "@/lib/auth-client";

const schema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters")
});

export function SignInPage() {
  const navigate = useNavigate();
  const session = authClient.useSession();
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" }
  });

  useEffect(() => {
    if (session.data) navigate("/admin", { replace: true });
  }, [session.data, navigate]);

  const submit = form.handleSubmit(async (values) => {
    const result = await authClient.signIn.email(values);
    if (result.error) {
      toast.error(result.error.message ?? "Could not sign in");
      return;
    }
    navigate("/admin", { replace: true });
  });

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-4 py-10">
      <section className="sg-enter w-full max-w-md rounded-xl bg-surface-raised p-6 sm:p-8">
        <div className="flex items-center gap-3">
          <span className="size-3.5 rounded-full bg-yellow" aria-hidden="true" />
          <p className="text-heading-s text-ink">Cozy Davao D-714</p>
        </div>
        <h1 className="mt-6 text-[32px] leading-9 font-semibold tracking-tight text-ink">Sign in</h1>
        <p className="mt-2 text-base text-ink-muted">Manage bookings and guest registrations.</p>
        <form className="mt-7 space-y-5" onSubmit={submit} noValidate>
          <IconField
            icon={Mail}
            label="Email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            error={form.formState.errors.email?.message}
            {...form.register("email")}
          />
          <IconField
            icon={Lock}
            label="Password"
            type="password"
            autoComplete="current-password"
            placeholder="Your password"
            error={form.formState.errors.password?.message}
            {...form.register("password")}
          />
          <Button
            size="lg"
            className="w-full"
            loading={form.formState.isSubmitting}
            loadingText="Signing in…"
          >
            Sign in
          </Button>
        </form>
      </section>
    </main>
  );
}
