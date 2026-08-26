import "server-only";

type PasswordResetEmail = {
  to: string;
  name: string;
  url: string;
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]!);
}

export async function sendPasswordResetEmail({ to, name, url }: PasswordResetEmail) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.AUTH_EMAIL_FROM;

  if (!apiKey || !from) {
    if (process.env.NODE_ENV !== "production") {
      console.info(`[auth-email] Password reset for ${to}: ${url}`);
      return;
    }
    throw new Error("Password reset email is not configured");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [to],
      subject: "Reset your Acquired password",
      text: `Hi ${name},\n\nReset your Acquired password using this link (valid for one hour):\n${url}\n\nIf you did not request this, you can ignore this email.`,
      html: `<p>Hi ${escapeHtml(name)},</p><p>Reset your Acquired password using the link below. It is valid for one hour.</p><p><a href="${escapeHtml(url)}">Reset password</a></p><p>If you did not request this, you can ignore this email.</p>`,
    }),
  });

  if (!response.ok) throw new Error(`Password reset email failed with status ${response.status}`);
}
