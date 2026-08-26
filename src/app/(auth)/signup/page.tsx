"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhoneCall } from "lucide-react";

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBusy(false);
      setError(data.error ?? "Could not create the account.");
      return;
    }
    // Auto sign in, then land in-app (you'll see the "pending access" page until
    // an admin assigns you a role).
    await signIn("credentials", { email, password, redirect: false });
    setBusy(false);
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
            <h1 className="text-lg font-semibold">Create account</h1>
            <p className="text-xs text-muted-foreground">Sales Platform</p>
          </div>
        </div>
        <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        <Input type="password" placeholder="Password (min 8 chars)" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Creating…" : "Create account"}
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="text-primary underline">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
