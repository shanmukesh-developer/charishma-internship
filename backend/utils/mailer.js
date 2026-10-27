// Transactional email via Brevo's free HTTP API (300 emails/day, no SDK, works on Render
// because it uses HTTPS instead of blocked SMTP ports).
//
// Env:
//   BREVO_API_KEY  required. Without it isMailerConfigured() is false and nothing is sent.
//   MAIL_FROM      optional, "Name <email>" or "email". Default "Zenvy <projectshanmukh@gmail.com>".
//                  The address must be a verified sender in the Brevo account.
//
// Never logs the API key, the recipient's code or the message body.

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';
const DEFAULT_FROM = 'ZCS <projectshanmukh@gmail.com>';
const TIMEOUT_MS = () => Math.max(1000, Number(process.env.MAIL_TIMEOUT_MS) || 10000); // A5: env-tunable, default 10 s (unchanged)

const isMailerConfigured = () => !!String(process.env.BREVO_API_KEY || '').trim();

/** "Zenvy <a@b.com>" -> { name: 'Zenvy', email: 'a@b.com' }; "a@b.com" -> { email } */
const parseSender = (raw) => {
  const value = String(raw || '').trim() || DEFAULT_FROM;
  const m = value.match(/^\s*"?([^"<]*?)"?\s*<\s*([^>\s]+@[^>\s]+)\s*>\s*$/);
  if (m) {
    const name = m[1].trim();
    return name ? { name, email: m[2] } : { email: m[2] };
  }
  if (/^[^\s@<>]+@[^\s@<>]+$/.test(value)) return { email: value };
  return parseSender(DEFAULT_FROM);
};

const maskEmail = (email) => {
  const [user, domain] = String(email || '').split('@');
  if (!domain) return '***';
  return `${user.slice(0, 2)}***@${domain}`;
};

/**
 * Send one email. Never throws.
 * @returns {Promise<{ok: boolean, reason?: string, messageId?: string}>}
 *   reason: 'not_configured' | 'invalid_recipient' | 'timeout' | 'rejected_<status>' | 'network_error'
 */
const sendMail = async ({ to, subject, html, text }) => {
  if (!isMailerConfigured()) return { ok: false, reason: 'not_configured' };
  const recipient = String(to || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) return { ok: false, reason: 'invalid_recipient' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS());
  try {
    const res = await fetch(BREVO_URL, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'api-key': String(process.env.BREVO_API_KEY).trim(),
      },
      body: JSON.stringify({
        sender: parseSender(process.env.MAIL_FROM),
        to: [{ email: recipient }],
        subject: String(subject || 'ZCS').slice(0, 200),
        htmlContent: html || undefined,
        textContent: text || undefined,
      }),
      signal: controller.signal,
    });
    if (res.ok) {
      let messageId;
      try { messageId = (await res.json()).messageId; } catch { /* body is optional */ }
      console.log(`[MAILER] sent to ${maskEmail(recipient)}`);
      return { ok: true, messageId };
    }
    // Brevo error bodies contain a code/message, never our key; log only the code.
    let code = '';
    let detail = '';
    try { const body = await res.json(); code = body.code || ''; detail = String(body.message || '').slice(0, 200); } catch { /* ignore */ }
    console.warn(`[MAILER] Brevo rejected (${res.status}${code ? ` ${code}` : ''}${detail ? `: ${detail}` : ''}) for ${maskEmail(recipient)}`);
    return { ok: false, reason: `rejected_${res.status}`, code, detail };
  } catch (err) {
    const timedOut = err && err.name === 'AbortError';
    console.warn(`[MAILER] ${timedOut ? 'timeout' : 'network error'} for ${maskEmail(recipient)}`);
    return { ok: false, reason: timedOut ? 'timeout' : 'network_error' };
  } finally {
    clearTimeout(timer);
  }
};

const escapeHtml = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** College verification code email. */
const sendVerificationCode = async ({ to, code, name, campusName, minutes = 10 }) => {
  const first = name ? String(name).trim().split(/\s+/)[0].slice(0, 40) : '';
  const hiPlain = first ? `Hi ${first},` : 'Hi,';
  const hi = escapeHtml(hiPlain);
  const campus = campusName ? ` for ${escapeHtml(campusName)}` : '';
  const digits = String(code);
  const subject = `${digits} is your ZCS campus verification code`;
  const text = [
    hiPlain,
    '',
    `Your ZCS Campus verification code${campusName ? ` for ${campusName}` : ''} is: ${digits}`,
    '',
    `It expires in ${minutes} minutes and can be used once.`,
    'If you did not ask for this, you can ignore this email. Never share this code with anyone.',
    '',
    'Team ZCS',
  ].join('\n');
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f7;font-family:Arial,Helvetica,sans-serif;color:#1d1d1f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:460px;background:#ffffff;border-radius:16px;padding:28px">
<tr><td style="font-size:20px;font-weight:bold;color:#ff5a1f;padding-bottom:16px">ZCS Campus</td></tr>
<tr><td style="font-size:15px;line-height:22px;padding-bottom:8px">${hi}</td></tr>
<tr><td style="font-size:15px;line-height:22px;padding-bottom:20px">Use this code to verify your college email${campus}:</td></tr>
<tr><td align="center" style="padding-bottom:20px"><div style="display:inline-block;font-size:32px;letter-spacing:8px;font-weight:bold;background:#fff3ec;color:#1d1d1f;border-radius:12px;padding:14px 22px">${escapeHtml(digits)}</div></td></tr>
<tr><td style="font-size:13px;line-height:20px;color:#555">It expires in ${Number(minutes) || 10} minutes and works once. If you did not ask for this, ignore this email. Never share this code with anyone, ZCS will never ask for it.</td></tr>
</table></td></tr></table></body></html>`;
  return sendMail({ to, subject, html, text });
};

module.exports = { sendMail, sendVerificationCode, isMailerConfigured, parseSender };
