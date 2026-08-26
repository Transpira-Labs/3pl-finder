import { redirect } from "next/navigation";
import { requireSignedIn } from "@/lib/auth/guards";
import { AppShell } from "@/components/app-shell";
import { I18nProvider } from "@/lib/i18n/context";
import { MobileGate } from "@/components/mobile-gate";

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
        <MobileGate>
          <AppShell
            role={role}
            userName={session.user.name ?? session.user.email ?? "User"}
          >
            {children}
          </AppShell>
        </MobileGate>
      </I18nProvider>
    );
  }

  return (
    <I18nProvider>
      <MobileGate>
        <AppShell role="admin" userName="Poveda">
          {children}
        </AppShell>
      </MobileGate>
    </I18nProvider>
  );
}
