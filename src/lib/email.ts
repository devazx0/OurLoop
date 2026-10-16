import { Resend } from "resend";
import { prisma } from "./prisma";

// Server-only Resend client. Lazily initialised so the app builds/runs even when
// RESEND_API_KEY is not configured (mirrors the VAPID handling in ./push).
const configuredApiKey = process.env.RESEND_API_KEY;
const fromAddress =
  process.env.RESEND_FROM_EMAIL || "OurLoop <onboarding@resend.dev>";
const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:6003";

let resendClient: Resend | null = null;

function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY || configuredApiKey;
  if (!apiKey) return null;
  if (!resendClient) {
    resendClient = new Resend(apiKey);
  }
  return resendClient;
}

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/**
 * Send a single transactional email via Resend.
 */
export async function sendEmail(input: SendEmailInput) {
  const client = getResendClient();
  if (!client) {
    console.warn("Cannot send email: RESEND_API_KEY is not configured.");
    return { sent: false, error: "RESEND_API_KEY is not configured." };
  }

  try {
    const { data, error } = await client.emails.send({
      from: fromAddress,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    });

    if (error) {
      console.error("Resend email error:", error);
      return { sent: false, error: error.message };
    }

    return { sent: true, id: data?.id };
  } catch (error: unknown) {
    console.error("Failed to send email:", error);
    return {
      sent: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

interface MessageEmailOptions {
  senderUserId: string;
  coupleId: string;
  senderName: string;
  preview: string;
}

// Safety net: never email the same partner more than once per window. This keeps
// emails quiet during an active back-and-forth, when the partner is reading each
// message instantly (which resets the unread count).
const MESSAGE_EMAIL_COOLDOWN_MS = 10 * 60 * 1000;

/**
 * Email the partner about a new chat message, if they have email notifications
 * enabled. Returns silently when there is no partner, they have opted out, or
 * they were emailed within the cooldown window.
 */
export async function sendMessageEmailToPartner({
  senderUserId,
  coupleId,
  senderName,
  preview,
}: MessageEmailOptions) {
  try {
    const partnerMember = await prisma.coupleMember.findFirst({
      where: {
        coupleId,
        userId: { not: senderUserId },
      },
      include: {
        user: {
          select: {
            email: true,
            displayName: true,
            nickname: true,
            emailNotificationsEnabled: true,
            lastMessageEmailAt: true,
          },
        },
      },
    });

    if (!partnerMember) return { sent: false };

    const partner = partnerMember.user;
    if (!partner.emailNotificationsEnabled || !partner.email) {
      return { sent: false };
    }

    if (
      partner.lastMessageEmailAt &&
      Date.now() - partner.lastMessageEmailAt.getTime() < MESSAGE_EMAIL_COOLDOWN_MS
    ) {
      return { sent: false };
    }

    const partnerName = partner.nickname || partner.displayName || "there";
    const chatUrl = `${appUrl.replace(/\/$/, "")}/chat`;

    const result = await sendEmail({
      to: partner.email,
      subject: `${senderName} sent you a message 💌`,
      text: `Hi ${partnerName}, ${senderName} sent you a message on OurLoop: "${preview}" — Open the chat: ${chatUrl}`,
      html: renderMessageEmail({ partnerName, senderName, preview, chatUrl }),
    });

    if (result.sent) {
      await prisma.user
        .update({
          where: { id: partnerMember.userId },
          data: { lastMessageEmailAt: new Date() },
        })
        .catch(() => {});
    }

    return result;
  } catch (error) {
    console.error("Failed to send message email to partner:", error);
    return { sent: false };
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderMessageEmail({
  partnerName,
  senderName,
  preview,
  chatUrl,
}: {
  partnerName: string;
  senderName: string;
  preview: string;
  chatUrl: string;
}) {
  const safePartner = escapeHtml(partnerName);
  const safeSender = escapeHtml(senderName);
  const safePreview = escapeHtml(preview);

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>New message from ${safeSender}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#0E0D13;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0E0D13;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#171520;border:1px solid #292536;border-radius:24px;overflow:hidden;">
            <tr>
              <td style="padding:28px 28px 8px 28px;">
                <span style="display:inline-block;font-size:20px;font-weight:700;color:#F6F3EE;letter-spacing:-0.01em;">OurLoop</span>
                <span style="display:inline-block;margin-left:8px;font-size:11px;color:#9992A8;">a private world for two</span>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 28px 0 28px;">
                <h1 style="margin:0;font-size:18px;line-height:1.4;color:#F6F3EE;font-weight:600;">
                  ${safeSender} sent you a message 💌
                </h1>
                <p style="margin:10px 0 0 0;font-size:13px;line-height:1.6;color:#A6A0B8;">
                  Hi ${safePartner}, you have a new message waiting in your chat.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px 0 28px;">
                <div style="background-color:#121018;border:1px solid #292536;border-radius:16px;padding:16px 18px;">
                  <p style="margin:0;font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#9992A8;font-weight:700;">New message</p>
                  <p style="margin:8px 0 0 0;font-size:14px;line-height:1.5;color:#F6F3EE;word-break:break-word;">${safePreview}</p>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:22px 28px 8px 28px;">
                <a href="${chatUrl}" style="display:inline-block;background-color:#E26D54;color:#0E0D13;font-size:13px;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:12px;">Open Chat</a>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px 28px 28px;">
                <p style="margin:0;font-size:11px;line-height:1.6;color:#6F6A80;">
                  You're receiving this because email notifications are on for your OurLoop account. You can turn them off anytime from Notifications in the app.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
