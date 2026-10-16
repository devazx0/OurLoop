"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import {
  isPushSupported,
  isIOS,
  isStandalone,
  subscribeToPush,
  unsubscribeFromPush,
  triggerTestPush,
} from "@/lib/pushClient";
import { copyToClipboard } from "@/lib/clipboard";
import {
  Bell,
  Mail,
  Send,
  LogOut,
  Copy,
  Check,
  Smartphone,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";

interface SettingsViewProps {
  user: {
    displayName: string;
    nickname?: string | null;
    email: string;
  };
  partnerName: string;
  partner?: {
    displayName: string;
    nickname?: string | null;
  } | null;
  inviteCode?: string | null;
  initialEmailEnabled: boolean;
}

type Permission = NotificationPermission | "unsupported";

const emptySubscribe = () => () => {};

function readPermission(): Permission {
  if (typeof window === "undefined" || !isPushSupported()) {
    return "unsupported";
  }
  return Notification.permission;
}

export function SettingsView({
  user,
  partnerName,
  partner,
  inviteCode,
  initialEmailEnabled,
}: SettingsViewProps) {
  const router = useRouter();

  // Client-only flag: avoids hydration mismatches for device/browser-dependent UI.
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  const [emailEnabled, setEmailEnabled] = useState(initialEmailEnabled);
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);

  const [permissionOverride, setPermissionOverride] = useState<Permission | null>(
    null
  );
  const permission: Permission =
    permissionOverride ?? (mounted ? readPermission() : "unsupported");

  const [pushLoading, setPushLoading] = useState(false);
  const [testStatus, setTestStatus] = useState<string | null>(null);
  const [testSuccess, setTestSuccess] = useState(false);

  const [copied, setCopied] = useState(false);

  const youName = user.nickname || user.displayName;
  const partnerDisplayName = partner
    ? partner.nickname || partner.displayName
    : partnerName;

  const standalone = mounted ? isStandalone() : false;
  const iosDevice = mounted ? isIOS() : false;

  async function handleEmailToggle() {
    if (emailSaving) return;
    const next = !emailEnabled;
    setEmailSaving(true);
    setEmailError(null);
    setEmailEnabled(next); // optimistic update

    try {
      const res = await fetch("/api/user/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailNotificationsEnabled: next }),
      });
      if (!res.ok) throw new Error("Request failed");
      const data = await res.json();
      setEmailEnabled(Boolean(data.emailNotificationsEnabled));
    } catch {
      setEmailEnabled(!next); // revert on failure
      setEmailError("Couldn't update email notifications. Please try again.");
    } finally {
      setEmailSaving(false);
    }
  }

  async function handlePushToggle() {
    setPushLoading(true);
    setTestStatus(null);

    if (permission === "granted") {
      await unsubscribeFromPush();
      setPermissionOverride("default");
      setTestStatus("Push notifications turned off for this device.");
      setTestSuccess(false);
    } else {
      const res = await subscribeToPush();
      if (res.success) {
        setPermissionOverride("granted");
        setTestStatus("Push notifications enabled! Sending a quick test...");
        setTestSuccess(true);
        const testRes = await triggerTestPush();
        if (testRes.success) {
          setTestStatus("Test notification delivered! Check your notifications.");
        }
      } else {
        setTestStatus(res.error || "Failed to enable notifications.");
        setTestSuccess(false);
      }
    }
    setPushLoading(false);
  }

  async function handleTestPush() {
    setPushLoading(true);
    setTestStatus("Sending test notification...");
    const res = await triggerTestPush();
    setTestStatus(res.message);
    setTestSuccess(res.success);
    setPushLoading(false);
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  async function handleCopyInvite() {
    if (!inviteCode) return;
    const ok = await copyToClipboard(inviteCode);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="max-w-3xl mx-auto w-full space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#F6F3EE] font-serif">
          Settings
        </h1>
        <p className="text-xs text-[#9992A8]">
          Manage your notifications and account preferences
        </p>
      </header>

      {/* Account / Couple */}
      <section className="rounded-3xl bg-[#171520] border border-[#292536] p-5 shadow-sm">
        <h2 className="text-xs font-bold text-[#F6F3EE] uppercase tracking-wider mb-4">
          Your Space
        </h2>

        <div className="flex items-center gap-3.5">
          <div className="flex items-center">
            <div className="w-11 h-11 rounded-full bg-[#E26D54] flex items-center justify-center text-[#0E0D13] font-bold text-sm shadow-sm z-10">
              {youName.charAt(0)}
            </div>
            {partner ? (
              <div className="w-11 h-11 -ml-3.5 rounded-full bg-[#201D2B] border-2 border-[#171520] flex items-center justify-center text-[#F6F3EE] font-bold text-sm">
                {partnerDisplayName.charAt(0)}
              </div>
            ) : (
              <div className="w-11 h-11 -ml-3.5 rounded-full bg-[#201D2B]/80 border-2 border-dashed border-[#9992A8]/30 flex items-center justify-center text-[#9992A8] text-xs">
                +
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-[#F6F3EE] truncate">
              {youName} &amp; {partnerDisplayName}
            </p>
            <p className="text-[11px] text-[#9992A8] truncate mt-0.5">
              {user.email}
            </p>
          </div>
        </div>

        {inviteCode && (
          <button
            onClick={handleCopyInvite}
            className="mt-4 w-full py-2 px-3 rounded-xl bg-[#201D2B] hover:bg-[#282436] border border-white/[0.05] flex items-center justify-between text-[11px] text-[#9992A8] transition-colors"
          >
            <span className="flex items-center gap-1.5 truncate">
              {copied ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5 text-[#9992A8]" />
              )}
              <span className="truncate">
                Invite code:{" "}
                <strong className="text-[#E5B268]">{inviteCode}</strong>
              </span>
            </span>
            <span className="text-[10px] text-[#E5B268] font-medium shrink-0 ml-1">
              {copied ? "Copied" : "Copy"}
            </span>
          </button>
        )}
      </section>

      {/* Notifications */}
      <section className="rounded-3xl bg-[#171520] border border-[#292536] p-5 shadow-sm">
        <h2 className="text-xs font-bold text-[#F6F3EE] uppercase tracking-wider mb-4">
          Notifications
        </h2>

        {/* Email notifications */}
        <div className="flex items-center justify-between gap-3 p-3.5 rounded-2xl bg-[#0E0D13] border border-[#231E33]">
          <div className="flex items-center gap-2.5 min-w-0">
            <Mail className="w-4 h-4 text-[#E5B268] shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-medium text-[#F6F3EE]">
                Email Notifications
              </p>
              <p className="text-[10px] text-[#9992A8] leading-tight mt-0.5">
                Email me when {partnerName} sends a message
              </p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={emailEnabled}
            aria-label="Toggle email notifications"
            onClick={handleEmailToggle}
            disabled={emailSaving}
            className={`relative w-11 h-6 rounded-full shrink-0 transition-colors disabled:opacity-50 ${
              emailEnabled
                ? "bg-gradient-to-r from-[#E26D54] to-[#E5B268]"
                : "bg-[#2D283E]"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-[#F6F3EE] shadow transition-transform ${
                emailEnabled ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>
        {emailError && (
          <p className="mt-2 text-[11px] text-rose-400">{emailError}</p>
        )}

        {/* Push notifications */}
        <div className="mt-3 p-3.5 rounded-2xl bg-[#0E0D13] border border-[#231E33]">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <Bell className="w-4 h-4 text-[#E26D54] shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-medium text-[#F6F3EE]">
                  Push Notifications
                </p>
                <p className="text-[10px] text-[#9992A8] leading-tight mt-0.5 flex items-center gap-1.5">
                  <Smartphone className="w-3 h-3" />
                  {standalone ? "Installed App (PWA)" : "Web Browser"}
                  <span className="text-[#3A3450]">•</span>
                  {permission === "granted" ? (
                    <span className="text-emerald-400">Enabled</span>
                  ) : permission === "denied" ? (
                    <span className="text-rose-400">Blocked</span>
                  ) : permission === "unsupported" ? (
                    <span className="text-[#9992A8]">Unsupported</span>
                  ) : (
                    <span className="text-amber-300">Off</span>
                  )}
                </p>
              </div>
            </div>

            {permission !== "unsupported" && (
              <button
                onClick={handlePushToggle}
                disabled={pushLoading || permission === "denied"}
                className={`shrink-0 py-2 px-3 rounded-xl text-[11px] font-semibold transition-all disabled:opacity-50 ${
                  permission === "granted"
                    ? "bg-[#231E33] text-[#DDD8E8] hover:bg-[#2c2640]"
                    : "bg-[#E26D54] text-[#0E0D13] hover:bg-[#eb7d65]"
                }`}
              >
                {permission === "granted" ? "Disable" : "Enable"}
              </button>
            )}
          </div>

          {permission === "unsupported" && (
            <p className="mt-3 text-[11px] text-[#BBB4CA] flex items-start gap-2 leading-relaxed">
              <AlertCircle className="w-3.5 h-3.5 text-[#E5B268] shrink-0 mt-0.5" />
              Web Push requires iOS 16.4+ and a supported browser. Everything else
              still works great.
            </p>
          )}

          {iosDevice && !standalone && permission !== "unsupported" && (
            <p className="mt-3 text-[11px] text-amber-200 flex items-start gap-2 leading-relaxed">
              <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
              On iPhone, add OurLoop to your Home Screen before enabling
              notifications.
            </p>
          )}

          {permission === "granted" && (
            <button
              onClick={handleTestPush}
              disabled={pushLoading}
              className="mt-3 w-full py-2 px-4 bg-[#201D2B] hover:bg-[#282436] text-[#DDD8E8] text-[11px] font-medium rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-60"
            >
              <Send className="w-3.5 h-3.5" />
              Send Test Notification
            </button>
          )}

          {testStatus && (
            <div
              className={`mt-3 p-2.5 rounded-xl text-[11px] flex items-center gap-2 ${
                testSuccess
                  ? "bg-emerald-950/40 border border-emerald-800/40 text-emerald-300"
                  : "bg-[#201B2E] border border-[#302A44] text-[#DDD8E8]"
              }`}
            >
              {testSuccess ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              )}
              <p className="leading-relaxed">{testStatus}</p>
            </div>
          )}
        </div>
      </section>

      {/* Account actions */}
      <section className="rounded-3xl bg-[#171520] border border-[#292536] p-5 shadow-sm">
        <h2 className="text-xs font-bold text-[#F6F3EE] uppercase tracking-wider mb-4">
          Account
        </h2>
        <button
          onClick={handleLogout}
          className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-medium text-rose-400 bg-rose-500/10 hover:bg-rose-500/15 border border-rose-500/20 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Log out
        </button>
      </section>
    </div>
  );
}
