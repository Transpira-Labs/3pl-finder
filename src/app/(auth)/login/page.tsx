"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhoneCall } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await signIn("credentials", { email, password, redirect: false });
    setBusy(false);
    if (res?.error) {
      setError("Incorrect email or password.");
      return;
    }
    // Land on the app root; the guards route to the right home for your role.
    router.push("/");
    router.refresh();
  }

  return (
    <div className="mx-auto grid min-h-screen max-w-sm place-items-center px-6">
      <form onSubmit={submit} className="w-full space-y-4">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-primary/15 text-primary">
            <PhoneCall className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Sign in</h1>
            <p className="text-xs text-muted-foreground">Sales Platform</p>
          </div>
        </div>
        <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        <Input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          No account?{" "}
          <Link href="/signup" className="text-primary underline">
            Create one
          </Link>
        </p>
      </form>
    </div>
  );
}
