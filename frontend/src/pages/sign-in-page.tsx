import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Lock, Mail } from "lucide-react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Confetti } from "@/components/ui/confetti";
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
    <main className="flex min-h-screen items-center justify-center bg-lavender px-4 py-10">
      <section className="relative w-full max-w-sm overflow-hidden rounded-xl bg-surface-raised p-6 shadow-card sm:p-8">
        <div className="pt-2 text-center">
          <Confetti />
          <p className="text-label text-primary">Admin</p>
          <h1 className="font-display mt-2 text-[44px] leading-[50px] text-ink">Welcome back</h1>
          <p className="mt-2 text-sm text-ink-muted">Sign in to manage bookings and guest registrations.</p>
        </div>
        <form className="mt-8 space-y-5" onSubmit={submit} noValidate>
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
          <Button size="lg" className="w-full" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && <Loader2 className="size-4 animate-spin" />}
            Sign in
          </Button>
        </form>
      </section>
    </main>
  );
}
