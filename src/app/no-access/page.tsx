import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { getLiveRole, countAdmins, setUserRole } from "@/lib/auth/users";
import { homeFor } from "@/lib/auth/guards";
import { Button } from "@/components/ui/button";
import { Clock, ShieldCheck } from "lucide-react";

/** Landing for signed-in users whose role is still "none" (awaiting access). */
export default async function NoAccessPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const role = (await getLiveRole(session.user.id)) ?? "none";
  if (role !== "none") redirect(homeFor(role));

  // First-admin bootstrap (replaces the terminal `make-admin`): when no admin
  // exists yet, let this signed-in user claim admin from here.
  const needsBootstrap = (await countAdmins()) === 0;

  if (needsBootstrap) {
    return (
      <div className="mx-auto grid min-h-screen max-w-md place-items-center px-6 text-center">
        <div className="space-y-4">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-primary/15 text-primary">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-semibold">Set up your workspace</h1>
          <p className="text-sm text-muted-foreground">
            No admin exists yet. As the first user, you can claim the admin role and start
            configuring the platform. After this, new members get their roles from
            Settings → Team.
          </p>
          <form
            action={async () => {
              "use server";
              const s = await auth();
              if (!s?.user) redirect("/login");
              if ((await countAdmins()) === 0) await setUserRole(s.user.id, "admin");
              redirect("/dashboard");
            }}
          >
            <Button type="submit" className="gap-1.5">
              <ShieldCheck className="h-4 w-4" /> Become the first admin
            </Button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto grid min-h-screen max-w-md place-items-center px-6 text-center">
      <div className="space-y-4">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-amber-100 text-amber-700">
          <Clock className="h-6 w-6" />
        </div>
        <h1 className="text-xl font-semibold">You haven’t been given access yet</h1>
        <p className="text-sm text-muted-foreground">
          Your account (<span className="font-medium">{session.user.email}</span>) is
          created but an admin hasn’t assigned you a role. Once they make you a rep or
          an admin, you’ll be able to sign in and get to work.
        </p>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <Button type="submit" variant="outline">Sign out</Button>
        </form>
      </div>
    </div>
  );
}
