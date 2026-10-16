import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { AppShell } from "@/components/layout/AppShell";
import { SettingsView } from "@/components/settings/SettingsView";

export default async function SettingsPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  if (!user.coupleId) {
    redirect("/pair");
  }

  const partnerName = user.partner
    ? user.partner.nickname || user.partner.displayName
    : "your partner";

  return (
    <AppShell
      user={{
        displayName: user.displayName,
        nickname: user.nickname,
      }}
      partner={user.partner}
      inviteCode={user.couple?.inviteCode}
    >
      <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 no-scrollbar">
        <SettingsView
          user={{
            displayName: user.displayName,
            nickname: user.nickname,
            email: user.email,
          }}
          partnerName={partnerName}
          partner={
            user.partner
              ? {
                  displayName: user.partner.displayName,
                  nickname: user.partner.nickname,
                }
              : null
          }
          inviteCode={user.couple?.inviteCode}
          initialEmailEnabled={user.emailNotificationsEnabled}
        />
      </main>
    </AppShell>
  );
}
