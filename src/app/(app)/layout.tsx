import { redirect } from "next/navigation";
import { requireSignedIn } from "@/lib/auth/guards";
import { AppShell } from "@/components/app-shell";
import { I18nProvider } from "@/lib/i18n/context";


/** Set to true to require login. False = skip auth entirely. */
const REQUIRE_LOGIN = false;

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (REQUIRE_LOGIN) {
    const { session, role } = await requireSignedIn();
    if (role === "none") redirect("/no-access");
    return (
      <I18nProvider>
        <AppShell
          role={role}
          userName={session.user.name ?? session.user.email ?? "User"}
        >
          {children}
        </AppShell>
      </I18nProvider>
    );
  }

  return (
    <I18nProvider>
      <AppShell role="admin" userName="Poveda">
        {children}
      </AppShell>
    </I18nProvider>
  );
}
