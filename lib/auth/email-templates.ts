/**
 * lib/auth/email-templates.ts — HTML + plain-text email templates.
 *
 * All templates are self-contained inline-style HTML so they render correctly
 * in all major email clients without an external CSS file.
 *
 * SERVER-ONLY — never import from client components.
 */

import {
  buildNotificationIconHtml,
  parseIconTimeLabel,
} from '@/lib/notificationIcon'

// ─── Shared constants ─────────────────────────────────────────────────────────

const BRAND_NAME    = 'LifeFlow'
const BRAND_COLOR   = '#2563eb'
const BRAND_TAGLINE = 'Plan. Focus. Achieve.'

// ─── Shared shell ─────────────────────────────────────────────────────────────

/**
 * Premium Apple-inspired email shell.
 * Very light cool-gray outer background, centered white card with generous
 * border-radius, subtle 1px border, barely-there shadow, refined header with
 * a pill-shaped brand mark and small-caps tagline, and a restrained footer.
 *
 * Structure is table-based for maximum email-client compatibility (Outlook,
 * Gmail, Apple Mail, Yahoo, Android).  All CSS is inlined.  No external
 * resources, no JavaScript, no web fonts, no tracking pixels.
 */
function wrapHtml(innerHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <!--
    color-scheme: prevent dark-mode forced inversions on Apple Mail / iOS Mail
    while keeping Gmail (which ignores these) on the light path.
  -->
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>${BRAND_NAME}</title>
  <!--[if !mso]><!-->
  <style type="text/css">
    /* ── Reset ──────────────────────────────────────────── */
    body, table, td, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
    table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
    img { border:0; height:auto; line-height:100%; outline:none; text-decoration:none; -ms-interpolation-mode:bicubic; }
    a { color:inherit; }

    /* ── Mobile breakpoint ──────────────────────────────── */
    @media only screen and (max-width:640px) {
      .outer-wrap   { padding:24px 0 32px !important; }
      .email-card   { border-radius:0 !important; border-left:0 !important; border-right:0 !important; }
      .email-header { padding:28px 24px 22px !important; }
      .email-body   { padding:32px 24px 28px !important; }
      .email-footer { padding:18px 24px 24px !important; }
      .btn-cta      { display:block !important; width:auto !important;
                      padding:15px 24px !important; box-sizing:border-box !important; }
      .fallback-url { font-size:11px !important; }
      h1.heading    { font-size:23px !important; line-height:1.2 !important; }
    }
  </style>
  <!--<![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#eef2f7;word-spacing:normal;">

  <!--[if mso]><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#eef2f7"><tr><td align="center"><![endif]-->

  <!-- ══ Outer wrapper ══════════════════════════════════════════════════════ -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
         class="outer-wrap"
         style="background-color:#eef2f7;padding:52px 16px 60px;min-width:100%;">
    <tr>
      <td align="center" valign="top">

        <!-- ══ Card ═══════════════════════════════════════════════════════ -->
        <table role="presentation" class="email-card" cellpadding="0" cellspacing="0" border="0"
               style="max-width:600px;width:100%;background-color:#ffffff;
                      border-radius:22px;
                      border:1px solid #dce3ef;
                      box-shadow:0 2px 8px rgba(15,23,42,0.06),
                                 0 8px 32px rgba(15,23,42,0.05);
                      overflow:hidden;">

          <!-- ─── Header ────────────────────────────────────────────────── -->
          <tr>
            <td class="email-header"
                style="padding:32px 48px 26px;
                       border-bottom:1px solid #edf0f7;
                       text-align:center;
                       background-color:#ffffff;">

              <!--
                Brand lockup: pill-shaped icon tile + name.
                The SVG bolt is a crisp, well-drawn lightning shape that renders
                crisply on HiDPI screens.  It needs no external image.
              -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0"
                     align="center" style="margin:0 auto 8px;">
                <tr>
                  <td valign="middle" style="padding-right:8px;">
                    <!--
                      Lightning bolt icon tile.
                      Outer rect: 24×24 with 7px radius — matches iOS app-icon style.
                      Inner bolt: geometrically correct with a sharp spine.
                    -->
                    <svg width="28" height="28" viewBox="0 0 28 28" fill="none"
                         xmlns="http://www.w3.org/2000/svg"
                         role="img" aria-label="${BRAND_NAME} logo"
                         style="display:block;vertical-align:middle;">
                      <rect width="28" height="28" rx="7" fill="${BRAND_COLOR}"/>
                      <!-- Lightning bolt — spine from top-right to bottom-left,
                           tail kicks back right.  Clean, professional mark. -->
                      <polygon points="17,4 10,15.5 14.2,15.5 11,24 19.5,12 15,12"
                               fill="#ffffff"/>
                    </svg>
                  </td>
                  <td valign="middle">
                    <span style="font-family:-apple-system,BlinkMacSystemFont,
                                 'Segoe UI','Helvetica Neue',Arial,sans-serif;
                                 font-size:18px;font-weight:700;color:#0f172a;
                                 letter-spacing:-0.4px;line-height:1;">
                      ${BRAND_NAME}
                    </span>
                  </td>
                </tr>
              </table>

              <!-- Tagline — small-caps optical treatment, muted -->
              <p style="margin:0;
                        font-family:-apple-system,BlinkMacSystemFont,
                                     'Segoe UI','Helvetica Neue',Arial,sans-serif;
                        font-size:10.5px;font-weight:500;
                        color:#9eafc2;letter-spacing:0.9px;
                        text-transform:uppercase;">
                ${BRAND_TAGLINE}
              </p>

            </td>
          </tr>

          <!-- ─── Body ──────────────────────────────────────────────────── -->
          <tr>
            <td class="email-body" style="padding:44px 52px 40px;">
              ${innerHtml}
            </td>
          </tr>

          <!-- ─── Footer ────────────────────────────────────────────────── -->
          <tr>
            <td class="email-footer"
                style="padding:22px 52px 30px;
                       border-top:1px solid #edf0f7;
                       background-color:#f9fafb;
                       text-align:center;">

              <p style="margin:0 0 3px;
                        font-family:-apple-system,BlinkMacSystemFont,
                                     'Segoe UI','Helvetica Neue',Arial,sans-serif;
                        font-size:13px;font-weight:600;color:#1e293b;
                        letter-spacing:-0.1px;">
                ${BRAND_NAME}
              </p>
              <p style="margin:0 0 12px;
                        font-family:-apple-system,BlinkMacSystemFont,
                                     'Segoe UI','Helvetica Neue',Arial,sans-serif;
                        font-size:11px;font-weight:400;
                        color:#9eafc2;letter-spacing:0.6px;
                        text-transform:uppercase;">
                ${BRAND_TAGLINE}
              </p>
              <p style="margin:0;
                        font-family:-apple-system,BlinkMacSystemFont,
                                     'Segoe UI','Helvetica Neue',Arial,sans-serif;
                        font-size:11.5px;color:#b2bfcd;line-height:1.75;">
                &copy;&nbsp;2026&nbsp;${BRAND_NAME}. All rights reserved.<br />
                This is an automated email. Please do not reply.
              </p>

            </td>
          </tr>

        </table>
        <!-- /Card -->

      </td>
    </tr>
  </table>
  <!-- /Outer wrapper -->

  <!--[if mso]></td></tr></table><![endif]-->
</body>
</html>`
}

// ─── Email verification ───────────────────────────────────────────────────────

export interface VerificationEmailOptions {
  toName: string
  verificationUrl: string
  /** Token lifetime in minutes (default: 8). */
  expiresInMinutes?: number
}

/**
 * Verification email — sent when a new user signs up or requests a resend.
 *
 * Design goals:
 *  - Premium, Apple-inspired transactional email
 *  - No external resources, no JS, no tracking, no marketing language
 *  - Single clear action: verify email
 *  - Table-based layout for Outlook/Gmail/Apple Mail compatibility
 *  - Inline CSS only, responsive to 320 px
 */
export function buildVerificationEmail(opts: VerificationEmailOptions): {
  subject: string
  html: string
  text: string
} {
  const { toName, verificationUrl, expiresInMinutes = 8 } = opts
  const firstName = toName.split(' ')[0] ?? toName

  // Human-readable expiry — stays in minutes when < 60, converts to hours otherwise.
  const expiryLabel =
    expiresInMinutes < 60
      ? `${expiresInMinutes} minutes`
      : `${Math.round(expiresInMinutes / 60)} hours`

  const subject = `Verify your ${BRAND_NAME} email address`

  /* ─────────────────────────────────────────────────────────────────────────
     HTML body — injected into wrapHtml().

     Sections:
       1. Verification icon  (envelope + check badge — inline SVG)
       2. Heading            ("Verify your email address")
       3. Greeting + body copy
       4. CTA button         ("Verify Email →")
       5. Expiry notice      ("This link expires in 8 minutes.")
       6. Thin rule
       7. Fallback URL box   (for clients that block buttons)
       8. Thin rule
       9. Security notice    (non-alarmist)
   ───────────────────────────────────────────────────────────────────────── */
  const html = wrapHtml(`

    <!-- ══ 1. Verification icon ══════════════════════════════════════════ -->
    <!--
      A clean envelope-plus-check-badge composed entirely from SVG primitives.
      The outer pale-blue circle gives it visual weight without an image request.
      The check-mark badge sits at the top-right corner of the envelope — a
      common, instantly recognisable "email verified" visual cue.

      Note: Gmail strips <div> inside tables in some contexts; wrapping the SVG
      in a single <td> with text-align:center is the safest pattern.
    -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"
           width="100%" style="margin:0 0 30px;">
      <tr>
        <td align="center">
          <svg width="72" height="72" viewBox="0 0 72 72" fill="none"
               xmlns="http://www.w3.org/2000/svg"
               role="img" aria-label="Email verification"
               style="display:block;margin:0 auto;">

            <!-- ░ Outer glow circle — very light blue -->
            <circle cx="36" cy="36" r="36" fill="#eff6ff"/>

            <!-- ░ Inner circle — slightly deeper -->
            <circle cx="36" cy="36" r="28" fill="#dbeafe"/>

            <!-- ░ Envelope body — rounded rect -->
            <rect x="16" y="24" width="40" height="28" rx="4.5"
                  fill="#ffffff" stroke="#93c5fd" stroke-width="1.5"/>

            <!-- ░ Envelope flap — V-shape from top corners to centre -->
            <polyline points="16,28 36,42 56,28"
                      fill="none" stroke="#60a5fa" stroke-width="1.5"
                      stroke-linecap="round" stroke-linejoin="round"/>

            <!-- ░ Check-mark badge — solid blue circle, white tick -->
            <circle cx="51" cy="23" r="10" fill="${BRAND_COLOR}"/>
            <!-- Tick: short left arm + long right arm -->
            <polyline points="46.5,23 49.5,26.5 55.5,19.5"
                      fill="none" stroke="#ffffff" stroke-width="2.2"
                      stroke-linecap="round" stroke-linejoin="round"/>

          </svg>
        </td>
      </tr>
    </table>

    <!-- ══ 2. Heading ════════════════════════════════════════════════════ -->
    <h1 class="heading"
        style="margin:0 0 24px;
               font-family:-apple-system,BlinkMacSystemFont,
                            'Segoe UI','Helvetica Neue',Arial,sans-serif;
               font-size:27px;font-weight:700;
               color:#0f172a;
               letter-spacing:-0.6px;line-height:1.2;
               text-align:center;">
      Verify your email address
    </h1>

    <!-- ══ 3. Greeting + body copy ═══════════════════════════════════════ -->
    <p style="margin:0 0 10px;
              font-family:-apple-system,BlinkMacSystemFont,
                           'Segoe UI','Helvetica Neue',Arial,sans-serif;
              font-size:16px;font-weight:400;color:#1e293b;line-height:1.65;">
      Hi ${escapeHtml(firstName)},
    </p>
    <p style="margin:0 0 36px;
              font-family:-apple-system,BlinkMacSystemFont,
                           'Segoe UI','Helvetica Neue',Arial,sans-serif;
              font-size:16px;font-weight:400;color:#334155;line-height:1.7;">
      Thanks for signing up for ${BRAND_NAME}. Please verify your email address
      to activate your account and start using ${BRAND_NAME}.
    </p>

    <!-- ══ 4. CTA button ═════════════════════════════════════════════════ -->
    <!--
      Outlook (MSO) uses VML for rounded buttons.  The v:roundrect block
      gives Outlook a proper pill-shaped button that matches the HTML version.
      All other clients use the <a> tag inside the <!--[if !mso]> guard.
    -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"
           width="100%" style="margin:0 0 18px;">
      <tr>
        <td align="center">

          <!--[if mso]>
          <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml"
                       xmlns:w="urn:schemas-microsoft-com:office:word"
                       href="${escapeHtml(verificationUrl)}"
                       style="height:52px;v-text-anchor:middle;width:220px;"
                       arcsize="50%" strokecolor="${BRAND_COLOR}" fillcolor="${BRAND_COLOR}">
            <w:anchorlock/>
            <center style="color:#ffffff;
                           font-family:Arial,sans-serif;
                           font-size:16px;font-weight:bold;">
              Verify Email &rarr;
            </center>
          </v:roundrect>
          <![endif]-->

          <!--[if !mso]><!-->
          <a class="btn-cta"
             href="${escapeHtml(verificationUrl)}"
             target="_blank"
             rel="noopener noreferrer"
             style="display:inline-block;
                    background-color:${BRAND_COLOR};
                    color:#ffffff;
                    font-family:-apple-system,BlinkMacSystemFont,
                                 'Segoe UI','Helvetica Neue',Arial,sans-serif;
                    font-size:16px;font-weight:600;
                    text-decoration:none;
                    padding:15px 44px;
                    border-radius:100px;
                    letter-spacing:-0.1px;
                    box-shadow:0 3px 12px rgba(37,99,235,0.30),
                               0 1px 3px rgba(37,99,235,0.20);
                    mso-hide:all;">
            Verify Email &rarr;
          </a>
          <!--<![endif]-->

        </td>
      </tr>
    </table>

    <!-- ══ 5. Expiry notice ═══════════════════════════════════════════════ -->
    <!--
      The token lifetime comes from the caller (VERIFICATION_TOKEN_EXPIRY_MINUTES
      env var, default 8).  This string will always match the actual token TTL.
    -->
    <p style="margin:0 0 36px;
              font-family:-apple-system,BlinkMacSystemFont,
                           'Segoe UI','Helvetica Neue',Arial,sans-serif;
              font-size:13px;font-weight:400;color:#94a3b8;
              text-align:center;line-height:1.5;">
      This link expires in
      <span style="color:#475569;font-weight:600;">${expiryLabel}</span>.
    </p>

    <!-- ══ 6. Thin rule ══════════════════════════════════════════════════ -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"
           width="100%" style="margin:0 0 26px;">
      <tr>
        <td style="height:1px;line-height:1px;font-size:1px;
                   background-color:#e8ecf3;">&nbsp;</td>
      </tr>
    </table>

    <!-- ══ 7. Fallback URL ═══════════════════════════════════════════════ -->
    <!--
      For clients that strip or block hyperlinked buttons, or plain-text
      readers, we expose the raw URL in a clearly labelled code-style box.
      word-break:break-all prevents long URLs from blowing out the layout on
      narrow screens.
    -->
    <p style="margin:0 0 6px;
              font-family:-apple-system,BlinkMacSystemFont,
                           'Segoe UI','Helvetica Neue',Arial,sans-serif;
              font-size:13px;font-weight:600;color:#1e293b;">
      Button not working?
    </p>
    <p style="margin:0 0 10px;
              font-family:-apple-system,BlinkMacSystemFont,
                           'Segoe UI','Helvetica Neue',Arial,sans-serif;
              font-size:13px;font-weight:400;color:#64748b;line-height:1.6;">
      Copy and paste this link into your browser:
    </p>

    <!-- URL pill box -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"
           width="100%" style="margin:0 0 30px;">
      <tr>
        <td style="background-color:#f1f5f9;
                   border:1px solid #e2e8f0;
                   border-radius:10px;
                   padding:13px 18px;">
          <p class="fallback-url"
             style="margin:0;
                    font-family:'SF Mono','Fira Code','Roboto Mono',
                                 Menlo,'Courier New',Courier,monospace;
                    font-size:12px;font-weight:400;
                    color:#2563eb;
                    line-height:1.65;
                    word-break:break-all;
                    word-wrap:break-word;
                    overflow-wrap:break-word;">
            ${escapeHtml(verificationUrl)}
          </p>
        </td>
      </tr>
    </table>

    <!-- ══ 8. Thin rule ══════════════════════════════════════════════════ -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"
           width="100%" style="margin:0 0 22px;">
      <tr>
        <td style="height:1px;line-height:1px;font-size:1px;
                   background-color:#e8ecf3;">&nbsp;</td>
      </tr>
    </table>

    <!-- ══ 9. Security notice ════════════════════════════════════════════ -->
    <!--
      Calm, factual wording — no alarmist language.  The small shield SVG
      gives it a visual anchor without looking threatening.
    -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"
           width="100%">
      <tr>

        <!-- Shield icon -->
        <td valign="top" width="26"
            style="padding-top:1px;padding-right:10px;">
          <svg width="17" height="17" viewBox="0 0 17 17" fill="none"
               xmlns="http://www.w3.org/2000/svg"
               role="img" aria-hidden="true"
               style="display:block;">
            <!-- Shield outline -->
            <path d="M8.5 1.5L2 4.25V8.5C2 12.05 4.8 15.35 8.5 16.5
                     C12.2 15.35 15 12.05 15 8.5V4.25L8.5 1.5Z"
                  fill="#dbeafe" stroke="#93c5fd" stroke-width="1.1"
                  stroke-linejoin="round"/>
            <!-- Tick inside shield -->
            <polyline points="6,8.5 7.8,10.3 11.5,6.5"
                      fill="none" stroke="${BRAND_COLOR}" stroke-width="1.2"
                      stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </td>

        <!-- Notice text -->
        <td valign="top">
          <p style="margin:0;
                    font-family:-apple-system,BlinkMacSystemFont,
                                 'Segoe UI','Helvetica Neue',Arial,sans-serif;
                    font-size:12.5px;font-weight:400;
                    color:#64748b;line-height:1.7;">
            <strong style="color:#334155;font-weight:600;">
              Didn&rsquo;t sign up?
            </strong>
            &nbsp;If you did not create a ${BRAND_NAME} account, you can safely
            ignore this email. Someone may have entered your email address by
            mistake.
          </p>
        </td>

      </tr>
    </table>

  `)

  /* ─────────────────────────────────────────────────────────────────────────
     Plain-text version — used by plain-text-only clients and spam filters.
     Short, factual, no marketing language.
   ───────────────────────────────────────────────────────────────────────── */
  const text = [
    `${BRAND_NAME}`,
    `${BRAND_TAGLINE}`,
    ``,
    `Verify your email address`,
    `${'─'.repeat(40)}`,
    ``,
    `Hi ${firstName},`,
    ``,
    `Thanks for signing up for ${BRAND_NAME}.`,
    ``,
    `Please verify your email address using this link:`,
    ``,
    verificationUrl,
    ``,
    `This link expires in ${expiryLabel}.`,
    ``,
    `${'─'.repeat(40)}`,
    ``,
    `If you did not create a ${BRAND_NAME} account, you can safely`,
    `ignore this email. Someone may have entered your email address by mistake.`,
    ``,
    `${'─'.repeat(40)}`,
    ``,
    `\u00A9 2026 ${BRAND_NAME}. All rights reserved.`,
    `This is an automated email. Please do not reply.`,
  ].join('\n')

  return { subject, html, text }
}

// ─── 2FA setup confirmation ───────────────────────────────────────────────────

export interface TwoFaEnabledEmailOptions {
  toName: string
  toEmail: string
}

/**
 * Notification email — sent after TOTP 2FA is successfully enabled.
 */
export function buildTwoFaEnabledEmail(opts: TwoFaEnabledEmailOptions): {
  subject: string
  html: string
  text: string
} {
  const { toName, toEmail } = opts
  const firstName = toName.split(' ')[0] ?? toName

  const subject = `Two-factor authentication enabled — ${BRAND_NAME}`

  const html = wrapHtml(`
    <h2 style="margin:0 0 8px;
               font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display',
                            'SF Pro Text','Segoe UI',Arial,sans-serif;
               font-size:22px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;">
      Two-factor authentication enabled
    </h2>
    <p style="margin:0 0 16px;
              font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                           'Segoe UI',Arial,sans-serif;
              font-size:15px;color:#334155;line-height:1.65;">
      Hi ${escapeHtml(firstName)},
    </p>
    <p style="margin:0 0 16px;
              font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                           'Segoe UI',Arial,sans-serif;
              font-size:15px;color:#334155;line-height:1.65;">
      Two-factor authentication (Google Authenticator) has been successfully enabled
      on your ${BRAND_NAME} account (<strong>${escapeHtml(toEmail)}</strong>).
    </p>
    <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:10px;
                padding:14px 16px;margin:0 0 16px;">
      <p style="margin:0;
                font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                             'Segoe UI',Arial,sans-serif;
                font-size:13.5px;color:#166534;line-height:1.65;">
        <strong>&#10003;</strong>&nbsp; Your account is now protected with an additional
        security layer. You will need your authenticator app to log in going forward.
      </p>
    </div>
    <p style="margin:0;
              font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                           'Segoe UI',Arial,sans-serif;
              font-size:13px;color:#64748b;line-height:1.65;">
      If you did not make this change, please contact support immediately and
      change your password.
    </p>
  `)

  const text =
    `Two-factor authentication enabled — ${BRAND_NAME}\n\n` +
    `Hi ${firstName},\n\n` +
    `Two-factor authentication (Google Authenticator) has been successfully enabled on your ${BRAND_NAME} account (${toEmail}).\n\n` +
    `Your account is now protected with an additional security layer. You will need your authenticator app to log in going forward.\n\n` +
    `If you did not make this change, please contact support immediately and change your password.\n\n` +
    `— The ${BRAND_NAME} Team`

  return { subject, html, text }
}

// ─── 2FA disabled notification ────────────────────────────────────────────────

export interface TwoFaDisabledEmailOptions {
  toName: string
  toEmail: string
}

/**
 * Notification email — sent after TOTP 2FA is disabled.
 */
export function buildTwoFaDisabledEmail(opts: TwoFaDisabledEmailOptions): {
  subject: string
  html: string
  text: string
} {
  const { toName, toEmail } = opts
  const firstName = toName.split(' ')[0] ?? toName

  const subject = `Two-factor authentication disabled — ${BRAND_NAME}`

  const html = wrapHtml(`
    <h2 style="margin:0 0 8px;
               font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display',
                            'SF Pro Text','Segoe UI',Arial,sans-serif;
               font-size:22px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;">
      Two-factor authentication disabled
    </h2>
    <p style="margin:0 0 16px;
              font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                           'Segoe UI',Arial,sans-serif;
              font-size:15px;color:#334155;line-height:1.65;">
      Hi ${escapeHtml(firstName)},
    </p>
    <p style="margin:0 0 16px;
              font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                           'Segoe UI',Arial,sans-serif;
              font-size:15px;color:#334155;line-height:1.65;">
      Two-factor authentication has been <strong>disabled</strong> on your
      ${BRAND_NAME} account (<strong>${escapeHtml(toEmail)}</strong>).
    </p>
    <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:10px;
                padding:14px 16px;margin:0 0 16px;">
      <p style="margin:0;
                font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                             'Segoe UI',Arial,sans-serif;
                font-size:13.5px;color:#991b1b;line-height:1.65;">
        <strong>&#9888;</strong>&nbsp; If you did not make this change, please change
        your password immediately and contact support.
      </p>
    </div>
    <p style="margin:0;
              font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                           'Segoe UI',Arial,sans-serif;
              font-size:13px;color:#64748b;line-height:1.65;">
      You can re-enable two-factor authentication at any time in your
      Security settings.
    </p>
  `)

  const text =
    `Two-factor authentication disabled — ${BRAND_NAME}\n\n` +
    `Hi ${firstName},\n\n` +
    `Two-factor authentication has been disabled on your ${BRAND_NAME} account (${toEmail}).\n\n` +
    `WARNING: If you did not make this change, please change your password immediately and contact support.\n\n` +
    `You can re-enable two-factor authentication at any time in your Security settings.\n\n` +
    `— The ${BRAND_NAME} Team`

  return { subject, html, text }
}

// ─── Utility ──────────────────────────────────────────────────────────────────

/** Minimal HTML escaping — prevents XSS in name/email/URL fields inside templates. */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// ─── Notification emails ──────────────────────────────────────────────────────
//
// These templates are used by the notification scheduler for meaningful
// user-facing reminders (task summaries, habit reminders, spending alerts,
// daily summary).
//
// RULES:
//  - Every template calls wrapHtml() to get the branded Apple-style shell.
//  - Templates are SEPARATE from verification/2FA emails — do not mix them.
//  - Content must be concise, non-sensitive, and actionable.
//  - Never include financial amounts, task descriptions, tokens, or passwords.
//  - Always provide a plain-text fallback.
//
// SERVER-ONLY — never import from client components.

// ─── Shared notification helper ───────────────────────────────────────────────

/** Render a simple bulleted item list as inline-CSS HTML table rows. */
function buildItemList(items: string[]): string {
  if (items.length === 0) return ''
  const rows = items
    .slice(0, 8) // never show more than 8 items in an email
    .map(
      (item) =>
        `<tr>
          <td valign="top" width="16"
              style="padding:3px 8px 3px 0;
                     font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                                  'Segoe UI',Arial,sans-serif;
                     font-size:14px;color:#2563eb;">•</td>
          <td valign="top"
              style="padding:3px 0;
                     font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                                  'Segoe UI',Arial,sans-serif;
                     font-size:14px;color:#334155;line-height:1.6;">
            ${escapeHtml(item)}
          </td>
        </tr>`
    )
    .join('\n')
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"
                 width="100%" style="margin:8px 0 24px;">${rows}</table>`
}

/** Render the standard "Open LifeFlow →" CTA button. */
function buildNotifCta(href: string, label = 'Open LifeFlow'): string {
  const safe = escapeHtml(href)
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"
           width="100%" style="margin:0 0 16px;">
      <tr>
        <td align="left">
          <a href="${safe}" target="_blank" rel="noopener noreferrer"
             style="display:inline-block;
                    background-color:${BRAND_COLOR};
                    color:#ffffff;
                    font-family:-apple-system,BlinkMacSystemFont,
                                 'Segoe UI','Helvetica Neue',Arial,sans-serif;
                    font-size:15px;font-weight:600;
                    text-decoration:none;
                    padding:12px 32px;
                    border-radius:100px;
                    letter-spacing:-0.1px;
                    box-shadow:0 2px 8px rgba(37,99,235,0.25);">
            ${escapeHtml(label)} &rarr;
          </a>
        </td>
      </tr>
    </table>`
}

/** Standard unsubscribe footer note for notification emails. */
const NOTIF_FOOTER = `<p style="margin:24px 0 0;
              font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                           'Segoe UI',Arial,sans-serif;
              font-size:12px;color:#94a3b8;line-height:1.6;">
  You can manage notification preferences in your
  <a href="${'{APP_URL}'}/app/profile" target="_blank" rel="noopener noreferrer"
     style="color:#64748b;text-decoration:underline;">LifeFlow profile settings</a>.
</p>`

function notifFooter(appUrl: string): string {
  return NOTIF_FOOTER.replace('{APP_URL}', appUrl)
}

// ─── Tomorrow tasks ────────────────────────────────────────────────────────────

export interface TomorrowTasksEmailOptions {
  toName: string
  taskCount: number
  taskTitles: string[]   // up to 5 titles (trimmed server-side before calling)
  tomorrowLabel: string  // e.g. "Tuesday, 13 Sep"
  appUrl: string
}

export function buildTomorrowTasksEmail(opts: TomorrowTasksEmailOptions): {
  subject: string
  html: string
  text: string
} {
  const { toName, taskCount, taskTitles, tomorrowLabel, appUrl } = opts
  const firstName = toName.split(' ')[0] ?? toName
  const taskWord  = taskCount === 1 ? 'task' : 'tasks'
  const subject   = `Tomorrow: ${taskCount} ${taskWord} scheduled — ${BRAND_NAME}`

  const html = wrapHtml(`
    <h2 style="margin:0 0 6px;
               font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display',
                            'Segoe UI',Arial,sans-serif;
               font-size:22px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;">
      Tomorrow: ${taskCount} ${taskWord} scheduled
    </h2>
    <p style="margin:0 0 20px;
              font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                           'Segoe UI',Arial,sans-serif;
              font-size:13px;color:#64748b;">
      ${escapeHtml(tomorrowLabel)}
    </p>
    <p style="margin:0 0 4px;
              font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                           'Segoe UI',Arial,sans-serif;
              font-size:15px;color:#334155;line-height:1.65;">
      Hi ${escapeHtml(firstName)}, here&rsquo;s what&rsquo;s coming up tomorrow:
    </p>
    ${buildItemList(taskTitles)}
    ${taskCount > taskTitles.length
      ? `<p style="margin:-16px 0 20px;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',Arial,sans-serif;font-size:13px;color:#94a3b8;">
           &hellip;and ${taskCount - taskTitles.length} more. Open LifeFlow to see all.
         </p>`
      : ''}
    ${buildNotifCta(`${appUrl}/app/tasks`)}
    ${notifFooter(appUrl)}
  `)

  const text = [
    `Tomorrow: ${taskCount} ${taskWord} scheduled`,
    `${tomorrowLabel}`,
    ``,
    `Hi ${firstName}, here's what's coming up tomorrow:`,
    ``,
    ...taskTitles.map((t) => `  • ${t}`),
    ...(taskCount > taskTitles.length
      ? [`  … and ${taskCount - taskTitles.length} more.`]
      : []),
    ``,
    `Open LifeFlow: ${appUrl}/app/tasks`,
    ``,
    `Manage notification preferences: ${appUrl}/app/profile`,
  ].join('\n')

  return { subject, html, text }
}

// ─── Incomplete today ──────────────────────────────────────────────────────────

export interface IncompleteTasksEmailOptions {
  toName: string
  taskCount: number
  taskTitles: string[]
  todayLabel: string   // e.g. "Monday, 12 Sep"
  appUrl: string
}

export function buildIncompleteTasksEmail(opts: IncompleteTasksEmailOptions): {
  subject: string
  html: string
  text: string
} {
  const { toName, taskCount, taskTitles, todayLabel, appUrl } = opts
  const firstName = toName.split(' ')[0] ?? toName
  const taskWord  = taskCount === 1 ? 'task' : 'tasks'
  const subject   = `${taskCount} incomplete ${taskWord} today — ${BRAND_NAME}`

  const html = wrapHtml(`
    <!-- ══ Time-based notification icon (7:00 PM) ════════════════════════ -->
    ${buildNotificationIconHtml('07:00', 'PM', '20px', { size: 80 })}

    <h2 style="margin:0 0 6px;
               font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display',
                            'Segoe UI',Arial,sans-serif;
               font-size:22px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;">
      ${taskCount} ${taskWord} still incomplete today
    </h2>
    <p style="margin:0 0 20px;
              font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                           'Segoe UI',Arial,sans-serif;
              font-size:13px;color:#64748b;">
      ${escapeHtml(todayLabel)}
    </p>
    <p style="margin:0 0 4px;
              font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                           'Segoe UI',Arial,sans-serif;
              font-size:15px;color:#334155;line-height:1.65;">
      Hi ${escapeHtml(firstName)}, you still have ${taskWord} to finish today:
    </p>
    ${buildItemList(taskTitles)}
    ${taskCount > taskTitles.length
      ? `<p style="margin:-16px 0 20px;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',Arial,sans-serif;font-size:13px;color:#94a3b8;">
           &hellip;and ${taskCount - taskTitles.length} more.
         </p>`
      : ''}
    ${buildNotifCta(`${appUrl}/app/tasks`)}
    ${notifFooter(appUrl)}
  `)

  const text = [
    `${taskCount} ${taskWord} still incomplete today`,
    `${todayLabel}`,
    ``,
    `Hi ${firstName}, you still have ${taskWord} to finish today:`,
    ``,
    ...taskTitles.map((t) => `  • ${t}`),
    ...(taskCount > taskTitles.length
      ? [`  … and ${taskCount - taskTitles.length} more.`]
      : []),
    ``,
    `Open LifeFlow: ${appUrl}/app/tasks`,
    ``,
    `Manage notification preferences: ${appUrl}/app/profile`,
  ].join('\n')

  return { subject, html, text }
}

// ─── Tomorrow habits ───────────────────────────────────────────────────────────

export interface TomorrowHabitsEmailOptions {
  toName: string
  habitCount: number
  habitNames: string[]
  tomorrowLabel: string
  appUrl: string
}

export function buildTomorrowHabitsEmail(opts: TomorrowHabitsEmailOptions): {
  subject: string
  html: string
  text: string
} {
  const { toName, habitCount, habitNames, tomorrowLabel, appUrl } = opts
  const firstName  = toName.split(' ')[0] ?? toName
  const habitWord  = habitCount === 1 ? 'habit' : 'habits'
  const subject    = `Tomorrow: ${habitCount} ${habitWord} planned — ${BRAND_NAME}`

  const html = wrapHtml(`
    <h2 style="margin:0 0 6px;
               font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display',
                            'Segoe UI',Arial,sans-serif;
               font-size:22px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;">
      Tomorrow: ${habitCount} ${habitWord} planned
    </h2>
    <p style="margin:0 0 20px;
              font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                           'Segoe UI',Arial,sans-serif;
              font-size:13px;color:#64748b;">
      ${escapeHtml(tomorrowLabel)}
    </p>
    <p style="margin:0 0 4px;
              font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                           'Segoe UI',Arial,sans-serif;
              font-size:15px;color:#334155;line-height:1.65;">
      Hi ${escapeHtml(firstName)}, keep the streak going tomorrow:
    </p>
    ${buildItemList(habitNames)}
    ${buildNotifCta(`${appUrl}/app/habits`)}
    ${notifFooter(appUrl)}
  `)

  const text = [
    `Tomorrow: ${habitCount} ${habitWord} planned`,
    `${tomorrowLabel}`,
    ``,
    `Hi ${firstName}, keep the streak going tomorrow:`,
    ``,
    ...habitNames.map((n) => `  • ${n}`),
    ``,
    `Open LifeFlow: ${appUrl}/app/habits`,
    ``,
    `Manage notification preferences: ${appUrl}/app/profile`,
  ].join('\n')

  return { subject, html, text }
}

// ─── Spending alert ────────────────────────────────────────────────────────────

export interface SpendingAlertEmailOptions {
  toName: string
  /** Human-readable category label e.g. "Food & Dining" */
  categoryLabel: string
  /** Percentage of budget used, 0–100+ */
  percentUsed: number
  appUrl: string
}

export function buildSpendingAlertEmail(opts: SpendingAlertEmailOptions): {
  subject: string
  html: string
  text: string
} {
  const { toName, categoryLabel, percentUsed, appUrl } = opts
  const firstName    = toName.split(' ')[0] ?? toName
  const isOver       = percentUsed >= 100
  const subject      = isOver
    ? `Budget exceeded: ${categoryLabel} — ${BRAND_NAME}`
    : `Budget alert: ${categoryLabel} is nearly full — ${BRAND_NAME}`

  const alertBg      = isOver ? '#fef2f2' : '#fffbeb'
  const alertBorder  = isOver ? '#fca5a5' : '#fcd34d'
  const alertColor   = isOver ? '#991b1b' : '#92400e'
  const alertIcon    = isOver ? '&#9888;' : '&#9432;'
  const alertMessage = isOver
    ? `Your <strong>${escapeHtml(categoryLabel)}</strong> budget has been exceeded (${percentUsed}% used).`
    : `Your <strong>${escapeHtml(categoryLabel)}</strong> budget is ${percentUsed}% used.`

  const html = wrapHtml(`
    <h2 style="margin:0 0 20px;
               font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display',
                            'Segoe UI',Arial,sans-serif;
               font-size:22px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;">
      ${isOver ? 'Budget exceeded' : 'Budget nearly full'}
    </h2>
    <div style="background:${alertBg};border:1px solid ${alertBorder};
                border-radius:10px;padding:14px 16px;margin:0 0 20px;">
      <p style="margin:0;
                font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                             'Segoe UI',Arial,sans-serif;
                font-size:14px;color:${alertColor};line-height:1.65;">
        ${alertIcon}&nbsp; ${alertMessage}
      </p>
    </div>
    <p style="margin:0 0 20px;
              font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                           'Segoe UI',Arial,sans-serif;
              font-size:15px;color:#334155;line-height:1.65;">
      Hi ${escapeHtml(firstName)}, open LifeFlow to review your spending and adjust
      your budget if needed.
    </p>
    ${buildNotifCta(`${appUrl}/app/budgets`)}
    ${notifFooter(appUrl)}
  `)

  const text = [
    subject,
    ``,
    `Hi ${firstName},`,
    ``,
    isOver
      ? `Your ${categoryLabel} budget has been exceeded (${percentUsed}% used).`
      : `Your ${categoryLabel} budget is ${percentUsed}% used and nearly full.`,
    ``,
    `Open LifeFlow to review your spending: ${appUrl}/app/budgets`,
    ``,
    `Manage notification preferences: ${appUrl}/app/profile`,
  ].join('\n')

  return { subject, html, text }
}

// ─── Daily summary ─────────────────────────────────────────────────────────────

export interface DailySummaryEmailOptions {
  toName: string
  todayLabel: string
  tasksCompleted: number
  tasksRemaining: number
  habitsCompleted: number
  habitsTotal: number
  /** Optional spending alert message, e.g. "Food budget is nearly full." */
  spendingNote?: string
  appUrl: string
}

export function buildDailySummaryEmail(opts: DailySummaryEmailOptions): {
  subject: string
  html: string
  text: string
} {
  const {
    toName,
    todayLabel,
    tasksCompleted,
    tasksRemaining,
    habitsCompleted,
    habitsTotal,
    spendingNote,
    appUrl,
  } = opts
  const firstName = toName.split(' ')[0] ?? toName
  const subject   = `Your LifeFlow daily summary — ${todayLabel}`

  function statRow(label: string, value: string): string {
    return `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;
                   font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                                'Segoe UI',Arial,sans-serif;
                   font-size:14px;color:#64748b;">${escapeHtml(label)}</td>
        <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;text-align:right;
                   font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                                'Segoe UI',Arial,sans-serif;
                   font-size:14px;font-weight:600;color:#0f172a;">${escapeHtml(value)}</td>
      </tr>`
  }

  const html = wrapHtml(`
    <!-- ══ Time-based notification icon (11:55 PM) ═══════════════════════ -->
    ${buildNotificationIconHtml('11:55', 'PM', '20px', { size: 80 })}

    <h2 style="margin:0 0 6px;
               font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display',
                            'Segoe UI',Arial,sans-serif;
               font-size:22px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;">
      Your daily summary
    </h2>
    <p style="margin:0 0 24px;
              font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                           'Segoe UI',Arial,sans-serif;
              font-size:13px;color:#64748b;">
      ${escapeHtml(todayLabel)}
    </p>
    <p style="margin:0 0 16px;
              font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                           'Segoe UI',Arial,sans-serif;
              font-size:15px;color:#334155;line-height:1.65;">
      Hi ${escapeHtml(firstName)}, here&rsquo;s how your day went:
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"
           width="100%" style="margin:0 0 20px;">
      ${statRow('Tasks completed',  `${tasksCompleted}`)}
      ${statRow('Tasks remaining',  `${tasksRemaining}`)}
      ${statRow('Habits completed', `${habitsCompleted} / ${habitsTotal}`)}
    </table>
    ${spendingNote
      ? `<div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:10px;
                     padding:12px 16px;margin:0 0 20px;">
           <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                              'Segoe UI',Arial,sans-serif;
                     font-size:13.5px;color:#92400e;line-height:1.6;">
             &#9432;&nbsp; ${escapeHtml(spendingNote)}
           </p>
         </div>`
      : ''}
    ${buildNotifCta(`${appUrl}/app/dashboard`)}
    ${notifFooter(appUrl)}
  `)

  const text = [
    `Your LifeFlow daily summary — ${todayLabel}`,
    ``,
    `Hi ${firstName},`,
    ``,
    `Tasks completed:  ${tasksCompleted}`,
    `Tasks remaining:  ${tasksRemaining}`,
    `Habits completed: ${habitsCompleted} / ${habitsTotal}`,
    ...(spendingNote ? [``, spendingNote] : []),
    ``,
    `Open LifeFlow: ${appUrl}/app/dashboard`,
    ``,
    `Manage notification preferences: ${appUrl}/app/profile`,
  ].join('\n')

  return { subject, html, text }
}

// ─── Password reset ───────────────────────────────────────────────────────────

export interface PasswordResetEmailOptions {
  toName: string
  resetUrl: string
  /** Token lifetime in minutes (default: 15). */
  expiresInMinutes?: number
}

/**
 * Password reset email — sent when a user requests a password reset.
 *
 * Design goals (matching the verification email):
 *  - Premium, Apple-inspired transactional email
 *  - No external resources, no JS, no tracking
 *  - Single clear action: reset password
 *  - Security notice for users who did not request the reset
 *  - Inline CSS only, table-based layout, responsive to 320 px
 *
 * Security notes:
 *  - resetUrl contains the raw token — it is NEVER logged by this function
 *  - The plain-text version repeats the URL so all clients can act on it
 */
export function buildPasswordResetEmail(opts: PasswordResetEmailOptions): {
  subject: string
  html: string
  text: string
} {
  const { toName, resetUrl, expiresInMinutes = 15 } = opts
  const firstName = toName.split(' ')[0] ?? toName

  const expiryLabel =
    expiresInMinutes < 60
      ? `${expiresInMinutes} minutes`
      : `${Math.round(expiresInMinutes / 60)} hour${Math.round(expiresInMinutes / 60) !== 1 ? 's' : ''}`

  const subject = `Reset your ${BRAND_NAME} password`

  const html = wrapHtml(`

    <!-- ══ 1. Lock icon ════════════════════════════════════════════════════ -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"
           width="100%" style="margin:0 0 30px;">
      <tr>
        <td align="center">
          <svg width="72" height="72" viewBox="0 0 72 72" fill="none"
               xmlns="http://www.w3.org/2000/svg"
               role="img" aria-label="Password reset"
               style="display:block;margin:0 auto;">

            <!-- ░ Outer glow circle -->
            <circle cx="36" cy="36" r="36" fill="#eff6ff"/>

            <!-- ░ Inner circle -->
            <circle cx="36" cy="36" r="28" fill="#dbeafe"/>

            <!-- ░ Lock body — rounded rectangle -->
            <rect x="22" y="34" width="28" height="20" rx="4"
                  fill="#ffffff" stroke="#93c5fd" stroke-width="1.5"/>

            <!-- ░ Lock shackle — open arc going left-to-right -->
            <path d="M27 34 V28 a9 9 0 0 1 18 0 V34"
                  fill="none" stroke="${BRAND_COLOR}" stroke-width="2.2"
                  stroke-linecap="round"/>

            <!-- ░ Keyhole circle -->
            <circle cx="36" cy="44" r="3" fill="${BRAND_COLOR}"/>

            <!-- ░ Keyhole stem -->
            <rect x="34.5" y="44" width="3" height="5" rx="1" fill="${BRAND_COLOR}"/>

          </svg>
        </td>
      </tr>
    </table>

    <!-- ══ 2. Heading ══════════════════════════════════════════════════════ -->
    <h1 class="heading"
        style="margin:0 0 8px;
               font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display',
                            'SF Pro Text','Segoe UI',Arial,sans-serif;
               font-size:26px;font-weight:700;color:#0f172a;
               letter-spacing:-0.5px;line-height:1.2;text-align:center;">
      Reset your password
    </h1>

    <p style="margin:0 0 28px;
              font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                           'Segoe UI',Arial,sans-serif;
              font-size:14px;color:#64748b;line-height:1.6;text-align:center;">
      We received a request to reset the password for your ${BRAND_NAME} account.
    </p>

    <!-- ══ 3. Greeting + body copy ════════════════════════════════════════ -->
    <p style="margin:0 0 12px;
              font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                           'Segoe UI',Arial,sans-serif;
              font-size:15px;color:#334155;line-height:1.65;">
      Hi ${escapeHtml(firstName)},
    </p>
    <p style="margin:0 0 28px;
              font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                           'Segoe UI',Arial,sans-serif;
              font-size:15px;color:#334155;line-height:1.65;">
      Click the button below to choose a new password. This link is valid for
      <strong>${expiryLabel}</strong> and can only be used once.
    </p>

    <!-- ══ 4. CTA button ══════════════════════════════════════════════════ -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"
           width="100%" style="margin:0 0 24px;">
      <tr>
        <td align="center">
          <a href="${escapeHtml(resetUrl)}"
             class="btn-cta"
             target="_blank"
             rel="noopener noreferrer"
             style="display:inline-block;
                    padding:15px 36px;
                    background-color:${BRAND_COLOR};
                    color:#ffffff;
                    font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                                 'Segoe UI',Arial,sans-serif;
                    font-size:15px;font-weight:600;
                    text-decoration:none;
                    border-radius:10px;
                    letter-spacing:-0.1px;
                    mso-padding-alt:0;
                    box-shadow:0 2px 8px rgba(37,99,235,0.35);">
            Reset Password &rarr;
          </a>
        </td>
      </tr>
    </table>

    <!-- ══ 5. Expiry notice ════════════════════════════════════════════════ -->
    <p style="margin:0 0 28px;
              font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                           'Segoe UI',Arial,sans-serif;
              font-size:13px;color:#94a3b8;line-height:1.6;text-align:center;">
      This link expires in <strong style="color:#64748b;">${expiryLabel}</strong>
      and becomes invalid after use.
    </p>

    <!-- ══ 6. Thin rule ═══════════════════════════════════════════════════ -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
           style="margin:0 0 24px;">
      <tr>
        <td style="border-top:1px solid #e2e8f0;font-size:0;line-height:0;">&nbsp;</td>
      </tr>
    </table>

    <!-- ══ 7. Fallback URL ════════════════════════════════════════════════ -->
    <p style="margin:0 0 6px;
              font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                           'Segoe UI',Arial,sans-serif;
              font-size:12px;color:#94a3b8;line-height:1.5;text-align:center;">
      Button not working? Copy and paste this link into your browser:
    </p>
    <p class="fallback-url"
       style="margin:0 0 24px;
              font-family:'Courier New',Courier,monospace;
              font-size:12px;color:#64748b;
              line-height:1.5;text-align:center;
              word-break:break-all;">
      ${escapeHtml(resetUrl)}
    </p>

    <!-- ══ 8. Thin rule ═══════════════════════════════════════════════════ -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
           style="margin:0 0 24px;">
      <tr>
        <td style="border-top:1px solid #e2e8f0;font-size:0;line-height:0;">&nbsp;</td>
      </tr>
    </table>

    <!-- ══ 9. Security notice ══════════════════════════════════════════════ -->
    <div style="background:#fef9ec;border:1px solid #fde68a;border-radius:10px;
                padding:14px 16px;margin:0;">
      <p style="margin:0;
                font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                             'Segoe UI',Arial,sans-serif;
                font-size:13px;color:#92400e;line-height:1.65;">
        <strong>&#x26A0;&#xFE0F; Didn't request this?</strong>
        If you did not ask to reset your password, you can safely ignore this email.
        Your password will remain unchanged. If you believe your account may be
        at risk, please log in and review your security settings.
      </p>
    </div>

  `)

  const text = [
    `${BRAND_NAME}`,
    `${BRAND_TAGLINE}`,
    ``,
    `Reset your ${BRAND_NAME} password`,
    `${'─'.repeat(40)}`,
    ``,
    `Hi ${firstName},`,
    ``,
    `We received a request to reset the password for your ${BRAND_NAME} account.`,
    ``,
    `Click the link below to choose a new password. This link is valid for ${expiryLabel} and can only be used once.`,
    ``,
    resetUrl,
    ``,
    `This link expires in ${expiryLabel} and becomes invalid after use.`,
    ``,
    `${'─'.repeat(40)}`,
    ``,
    `Didn't request this?`,
    `If you did not ask to reset your password, you can safely ignore this email.`,
    `Your password will remain unchanged.`,
    ``,
    `${'─'.repeat(40)}`,
    ``,
    `\u00A9 2026 ${BRAND_NAME}. All rights reserved.`,
    `This is an automated email. Please do not reply.`,
  ].join('\n')

  return { subject, html, text }
}

// ─── Tomorrow preview (10 PM) ─────────────────────────────────────────────────
//
// Sent at 10 PM in the user's local timezone.
// Shows tomorrow's tasks, habits, and any other scheduled items.
// Not sent if there is nothing planned for tomorrow.

export interface TomorrowPreviewEmailOptions {
  toName: string
  tomorrowLabel: string    // e.g. "Thursday, 17 Sep"
  taskCount: number
  taskTitles: string[]     // up to 5
  habitCount: number
  habitNames: string[]     // up to 5
  appUrl: string
}

export function buildTomorrowPreviewEmail(opts: TomorrowPreviewEmailOptions): {
  subject: string
  html: string
  text: string
} {
  const { toName, tomorrowLabel, taskCount, taskTitles, habitCount, habitNames, appUrl } = opts
  const firstName  = toName.split(' ')[0] ?? toName
  const subject    = `Tomorrow's plan is ready — ${BRAND_NAME}`

  const taskSection = taskCount > 0 ? `
    <p style="margin:0 0 4px;
              font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                           'Segoe UI',Arial,sans-serif;
              font-size:13px;font-weight:600;color:#0f172a;
              text-transform:uppercase;letter-spacing:0.6px;">
      Tasks (${taskCount})
    </p>
    ${buildItemList(taskTitles)}
    ${taskCount > taskTitles.length
      ? `<p style="margin:-16px 0 20px;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',Arial,sans-serif;font-size:13px;color:#94a3b8;">
           &hellip;and ${taskCount - taskTitles.length} more.
         </p>`
      : ''}
  ` : ''

  const habitSection = habitCount > 0 ? `
    <p style="margin:0 0 4px;
              font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                           'Segoe UI',Arial,sans-serif;
              font-size:13px;font-weight:600;color:#0f172a;
              text-transform:uppercase;letter-spacing:0.6px;">
      Habits (${habitCount})
    </p>
    ${buildItemList(habitNames)}
  ` : ''

  const html = wrapHtml(`
    <!-- ══ Time-based notification icon (10:00 PM) ═══════════════════════ -->
    ${buildNotificationIconHtml('10:00', 'PM', '20px', { size: 80 })}

    <h2 style="margin:0 0 6px;
               font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display',
                            'Segoe UI',Arial,sans-serif;
               font-size:22px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;">
      Tomorrow's plan is ready
    </h2>
    <p style="margin:0 0 24px;
              font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                           'Segoe UI',Arial,sans-serif;
              font-size:13px;color:#64748b;">
      ${escapeHtml(tomorrowLabel)}
    </p>
    <p style="margin:0 0 20px;
              font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                           'Segoe UI',Arial,sans-serif;
              font-size:15px;color:#334155;line-height:1.65;">
      Hi ${escapeHtml(firstName)}, here&rsquo;s what&rsquo;s planned for tomorrow:
    </p>
    ${taskSection}
    ${habitSection}
    ${buildNotifCta(`${appUrl}/app/dashboard`)}
    ${notifFooter(appUrl)}
  `)

  const taskLines = taskCount > 0 ? [
    `TASKS (${taskCount})`,
    ...taskTitles.map((t) => `  • ${t}`),
    ...(taskCount > taskTitles.length ? [`  … and ${taskCount - taskTitles.length} more.`] : []),
    ``,
  ] : []

  const habitLines = habitCount > 0 ? [
    `HABITS (${habitCount})`,
    ...habitNames.map((n) => `  • ${n}`),
    ``,
  ] : []

  const text = [
    `Tomorrow's plan is ready`,
    `${tomorrowLabel}`,
    ``,
    `Hi ${firstName}, here's what's planned for tomorrow:`,
    ``,
    ...taskLines,
    ...habitLines,
    `Open LifeFlow: ${appUrl}/app/dashboard`,
    ``,
    `Manage notification preferences: ${appUrl}/app/profile`,
  ].join('\n')

  return { subject, html, text }
}

// ─── Habit reminder email ─────────────────────────────────────────────────────
//
// Sent when incomplete habits are detected.
// Only sent when emailNotifications.habitReminders === true.

export interface HabitReminderEmailOptions {
  toName: string
  todayLabel: string
  incompleteCount: number
  habitNames: string[]   // up to 5 incomplete habit names
  totalCount: number
  appUrl: string
}

export function buildHabitReminderEmail(opts: HabitReminderEmailOptions): {
  subject: string
  html: string
  text: string
} {
  const { toName, todayLabel, incompleteCount, habitNames, totalCount, appUrl } = opts
  const firstName  = toName.split(' ')[0] ?? toName
  const habitWord  = incompleteCount === 1 ? 'habit' : 'habits'
  const subject    = `${incompleteCount} ${habitWord} still to complete — ${BRAND_NAME}`

  const completedCount = totalCount - incompleteCount
  const pct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0

  const html = wrapHtml(`
    <h2 style="margin:0 0 6px;
               font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display',
                            'Segoe UI',Arial,sans-serif;
               font-size:22px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;">
      Keep your streak going
    </h2>
    <p style="margin:0 0 24px;
              font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                           'Segoe UI',Arial,sans-serif;
              font-size:13px;color:#64748b;">
      ${escapeHtml(todayLabel)}
    </p>
    <p style="margin:0 0 8px;
              font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                           'Segoe UI',Arial,sans-serif;
              font-size:15px;color:#334155;line-height:1.65;">
      Hi ${escapeHtml(firstName)}, you have ${incompleteCount} ${habitWord} still
      to complete today. ${completedCount > 0 ? `You&rsquo;re ${pct}% of the way there.` : 'You can do it!'}
    </p>
    ${buildItemList(habitNames)}
    ${buildNotifCta(`${appUrl}/app/habits`)}
    ${notifFooter(appUrl)}
  `)

  const text = [
    `Keep your streak going — ${incompleteCount} ${habitWord} to complete`,
    `${todayLabel}`,
    ``,
    `Hi ${firstName}, you have ${incompleteCount} ${habitWord} still to complete today.`,
    ...(completedCount > 0 ? [`You're ${pct}% of the way there.`] : ['You can do it!']),
    ``,
    ...habitNames.map((n) => `  • ${n}`),
    ``,
    `Open LifeFlow: ${appUrl}/app/habits`,
    ``,
    `Manage notification preferences: ${appUrl}/app/profile`,
  ].join('\n')

  return { subject, html, text }
}

// ─── Weekly summary (Sunday 10 PM) ────────────────────────────────────────────
//
// Sent every Sunday at 10 PM in the user's local timezone.
// Covers the past 7 days (Mon–Sun).

export interface WeeklySummaryEmailOptions {
  toName: string
  weekLabel: string          // e.g. "10–16 Sep 2026"
  // Tasks
  tasksCompleted: number
  tasksTotal: number
  // Habits
  habitsCompleted: number
  habitsTotal: number        // total possible habit-days in the week
  // Expenses
  expenseCount: number
  topExpenseCategory?: string  // e.g. "Food & Dining"
  // Activity
  activeDays: number         // days with at least one task/habit completed
  appUrl: string
}

export function buildWeeklySummaryEmail(opts: WeeklySummaryEmailOptions): {
  subject: string
  html: string
  text: string
} {
  const {
    toName,
    weekLabel,
    tasksCompleted,
    tasksTotal,
    habitsCompleted,
    habitsTotal,
    expenseCount,
    topExpenseCategory,
    activeDays,
    appUrl,
  } = opts
  const firstName     = toName.split(' ')[0] ?? toName
  const taskPct       = tasksTotal > 0 ? Math.round((tasksCompleted / tasksTotal) * 100) : 0
  const habitPct      = habitsTotal > 0 ? Math.round((habitsCompleted / habitsTotal) * 100) : 0
  const subject       = `Your LifeFlow weekly summary — ${weekLabel}`

  function statRow(label: string, value: string): string {
    return `
      <tr>
        <td style="padding:9px 0;border-bottom:1px solid #f1f5f9;
                   font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                                'Segoe UI',Arial,sans-serif;
                   font-size:14px;color:#64748b;">${escapeHtml(label)}</td>
        <td style="padding:9px 0;border-bottom:1px solid #f1f5f9;text-align:right;
                   font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                                'Segoe UI',Arial,sans-serif;
                   font-size:14px;font-weight:600;color:#0f172a;">${escapeHtml(value)}</td>
      </tr>`
  }

  const html = wrapHtml(`
    <!-- ══ Time-based notification icon (10:00 PM — Sunday) ═════════════ -->
    ${buildNotificationIconHtml('10:00', 'PM', '20px', { size: 80 })}

    <h2 style="margin:0 0 6px;
               font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display',
                            'Segoe UI',Arial,sans-serif;
               font-size:22px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;">
      Your weekly summary
    </h2>
    <p style="margin:0 0 24px;
              font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                           'Segoe UI',Arial,sans-serif;
              font-size:13px;color:#64748b;">
      ${escapeHtml(weekLabel)}
    </p>
    <p style="margin:0 0 20px;
              font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                           'Segoe UI',Arial,sans-serif;
              font-size:15px;color:#334155;line-height:1.65;">
      Hi ${escapeHtml(firstName)}, here&rsquo;s how your week looked:
    </p>

    <!-- Tasks section -->
    <p style="margin:0 0 4px;
              font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                           'Segoe UI',Arial,sans-serif;
              font-size:11px;font-weight:600;color:#94a3b8;
              text-transform:uppercase;letter-spacing:0.8px;">
      Tasks
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"
           width="100%" style="margin:0 0 20px;">
      ${statRow('Completed',        `${tasksCompleted} / ${tasksTotal}`)}
      ${statRow('Completion rate',  `${taskPct}%`)}
    </table>

    <!-- Habits section -->
    <p style="margin:0 0 4px;
              font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                           'Segoe UI',Arial,sans-serif;
              font-size:11px;font-weight:600;color:#94a3b8;
              text-transform:uppercase;letter-spacing:0.8px;">
      Habits
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"
           width="100%" style="margin:0 0 20px;">
      ${statRow('Completed',        `${habitsCompleted} / ${habitsTotal}`)}
      ${statRow('Completion rate',  `${habitPct}%`)}
    </table>

    <!-- Spending section -->
    <p style="margin:0 0 4px;
              font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                           'Segoe UI',Arial,sans-serif;
              font-size:11px;font-weight:600;color:#94a3b8;
              text-transform:uppercase;letter-spacing:0.8px;">
      Spending
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"
           width="100%" style="margin:0 0 20px;">
      ${statRow('Transactions this week', `${expenseCount}`)}
      ${topExpenseCategory ? statRow('Top category', topExpenseCategory) : ''}
    </table>

    <!-- Activity -->
    <p style="margin:0 0 4px;
              font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                           'Segoe UI',Arial,sans-serif;
              font-size:11px;font-weight:600;color:#94a3b8;
              text-transform:uppercase;letter-spacing:0.8px;">
      Activity
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"
           width="100%" style="margin:0 0 24px;">
      ${statRow('Active days', `${activeDays} / 7`)}
    </table>

    ${buildNotifCta(`${appUrl}/app/dashboard`)}
    ${notifFooter(appUrl)}
  `)

  const text = [
    `Your LifeFlow weekly summary — ${weekLabel}`,
    ``,
    `Hi ${firstName}, here's how your week looked:`,
    ``,
    `TASKS`,
    `  Completed:        ${tasksCompleted} / ${tasksTotal} (${taskPct}%)`,
    ``,
    `HABITS`,
    `  Completed:        ${habitsCompleted} / ${habitsTotal} (${habitPct}%)`,
    ``,
    `SPENDING`,
    `  Transactions:     ${expenseCount}`,
    ...(topExpenseCategory ? [`  Top category:     ${topExpenseCategory}`] : []),
    ``,
    `ACTIVITY`,
    `  Active days:      ${activeDays} / 7`,
    ``,
    `Open LifeFlow: ${appUrl}/app/dashboard`,
    ``,
    `Manage notification preferences: ${appUrl}/app/profile`,
  ].join('\n')

  return { subject, html, text }
}

// ─── Task due-soon reminder (30 minutes before) ───────────────────────────────

export interface TaskReminderEmailOptions {
  /** Recipient's display name */
  toName: string
  /** Task title */
  taskTitle: string
  /** Human-readable due label — e.g. "Today at 8:00 PM" or "Wednesday at 3:30 PM" */
  dueLabel: string
  /** Recurrence description — e.g. "Daily" or "Weekly" — omit for one-time tasks */
  recurrenceLabel?: string
  /** Task priority — 'low' | 'medium' | 'high' */
  priority?: 'low' | 'medium' | 'high'
  /** Project or category name — optional */
  projectName?: string
  /**
   * Formatted reminder time label e.g. "10:00 AM".
   * Used in the time-based notification icon.  Defaults to "30 min" indicator
   * if not provided (backward-compatible).
   */
  reminderTimeLabel?: string
  /** Deep link URL */
  appUrl: string
}

/**
 * Build the "Task due in 30 minutes" reminder email.
 *
 * Sent automatically by the notification scheduler exactly 30 minutes before a
 * task's due time.  The recipient is always the user's registered LifeFlow email.
 *
 * Only sent when:
 *   • emailNotifications.enabled === true
 *   • emailNotifications.taskReminders === true
 *   • The task is NOT yet completed at the time of the reminder check
 */
export function buildTaskReminderEmail(opts: TaskReminderEmailOptions): {
  subject: string
  html: string
  text: string
} {
  const { toName, taskTitle, dueLabel, recurrenceLabel, priority, projectName, reminderTimeLabel, appUrl } = opts
  const firstName = toName.split(' ')[0] ?? toName
  const subject   = `Task reminder: ${taskTitle} — ${BRAND_NAME}`

  // Resolve time icon components from the reminder time label (dynamic) or fall back to a safe default
  const iconTime = reminderTimeLabel ? parseIconTimeLabel(reminderTimeLabel) : null

  // Priority badge — shown as a subtle pill only when priority is set
  const priorityColors: Record<string, { bg: string; text: string; label: string }> = {
    high:   { bg: '#fee2e2', text: '#dc2626', label: 'High priority' },
    medium: { bg: '#fef3c7', text: '#d97706', label: 'Medium priority' },
    low:    { bg: '#f0fdf4', text: '#16a34a', label: 'Low priority'  },
  }
  const badge = priority ? priorityColors[priority] : null
  const priorityPill = badge
    ? `<span style="display:inline-block;
                    background-color:${badge.bg};
                    color:${badge.text};
                    font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                                 'Segoe UI',Arial,sans-serif;
                    font-size:10.5px;font-weight:600;
                    padding:3px 10px;border-radius:100px;
                    letter-spacing:0.3px;vertical-align:middle;
                    margin-left:8px;">
        ${escapeHtml(badge.label)}
      </span>`
    : ''

  const html = wrapHtml(`

    <!-- ══ Time-based notification icon ═════════════════════════════════ -->
    <!-- Shows the actual scheduled reminder time instead of a clock icon -->
    ${iconTime
      ? buildNotificationIconHtml(iconTime.hhmm, iconTime.ampm, '28px', { size: 80 })
      : buildNotificationIconHtml('--:--', 'AM', '28px', { size: 80 })
    }

    <!-- ══ Heading ═══════════════════════════════════════════════════════ -->
    <h2 style="margin:0 0 6px;
               font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display',
                            'Segoe UI',Arial,sans-serif;
               font-size:22px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;
               text-align:center;">
      Your task is due in 30&nbsp;minutes
    </h2>
    <p style="margin:0 0 28px;
              font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                           'Segoe UI',Arial,sans-serif;
              font-size:13px;color:#64748b;text-align:center;">
      Hi ${escapeHtml(firstName)}, time to wrap up &mdash; this is due shortly.
    </p>

    <!-- ══ Task card ══════════════════════════════════════════════════════ -->
    <!--
      A bordered card presenting the key task details.  Rounded corners, light
      blue left accent border, soft shadow.  No images or external resources.
    -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"
           width="100%"
           style="margin:0 0 28px;
                  border:1px solid #dce3ef;
                  border-left:4px solid ${BRAND_COLOR};
                  border-radius:12px;
                  background-color:#f8faff;
                  box-shadow:0 1px 4px rgba(15,23,42,0.06);">
      <tr>
        <td style="padding:20px 24px 18px;">

          <!-- Task title + priority pill -->
          <p style="margin:0 0 10px;
                    font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display',
                                 'Segoe UI',Arial,sans-serif;
                    font-size:17px;font-weight:700;color:#0f172a;
                    letter-spacing:-0.2px;line-height:1.35;">
            ${escapeHtml(taskTitle)}${priorityPill}
          </p>

          <!-- Meta rows -->
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"
                 width="100%">

            <!-- Due row -->
            <tr>
              <td style="padding:4px 0;vertical-align:top;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td valign="top" style="padding-right:8px;">
                      <!-- Clock mini icon -->
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
                           xmlns="http://www.w3.org/2000/svg"
                           style="display:block;margin-top:1px;">
                        <circle cx="7" cy="7" r="6" stroke="#64748b" stroke-width="1.3"/>
                        <line x1="7" y1="7" x2="7" y2="4"
                              stroke="#64748b" stroke-width="1.3" stroke-linecap="round"/>
                        <line x1="7" y1="7" x2="10" y2="7"
                              stroke="#64748b" stroke-width="1.3" stroke-linecap="round"/>
                      </svg>
                    </td>
                    <td>
                      <span style="font-family:-apple-system,BlinkMacSystemFont,
                                               'SF Pro Text','Segoe UI',Arial,sans-serif;
                                   font-size:13px;color:#334155;line-height:1.5;">
                        <strong style="color:#1e293b;">Due</strong>&nbsp;&nbsp;
                        ${escapeHtml(dueLabel)}
                      </span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            ${recurrenceLabel ? `
            <!-- Recurrence row -->
            <tr>
              <td style="padding:4px 0;vertical-align:top;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td valign="top" style="padding-right:8px;">
                      <!-- Repeat icon -->
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
                           xmlns="http://www.w3.org/2000/svg"
                           style="display:block;margin-top:1px;">
                        <path d="M2 5h9M8 2l3 3-3 3" stroke="#64748b" stroke-width="1.3"
                              stroke-linecap="round" stroke-linejoin="round"/>
                        <path d="M12 9H3M6 6l-3 3 3 3" stroke="#64748b" stroke-width="1.3"
                              stroke-linecap="round" stroke-linejoin="round"/>
                      </svg>
                    </td>
                    <td>
                      <span style="font-family:-apple-system,BlinkMacSystemFont,
                                               'SF Pro Text','Segoe UI',Arial,sans-serif;
                                   font-size:13px;color:#334155;line-height:1.5;">
                        <strong style="color:#1e293b;">Recurrence</strong>&nbsp;&nbsp;
                        ${escapeHtml(recurrenceLabel)}
                      </span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>` : ''}

            ${projectName ? `
            <!-- Project row -->
            <tr>
              <td style="padding:4px 0;vertical-align:top;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td valign="top" style="padding-right:8px;">
                      <!-- Folder icon -->
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
                           xmlns="http://www.w3.org/2000/svg"
                           style="display:block;margin-top:1px;">
                        <path d="M1 4a1 1 0 011-1h3l1.5 1.5H12a1 1 0 011 1V11a1 1 0 01-1 1H2a1 1 0 01-1-1V4z"
                              stroke="#64748b" stroke-width="1.3" stroke-linejoin="round"/>
                      </svg>
                    </td>
                    <td>
                      <span style="font-family:-apple-system,BlinkMacSystemFont,
                                               'SF Pro Text','Segoe UI',Arial,sans-serif;
                                   font-size:13px;color:#334155;line-height:1.5;">
                        <strong style="color:#1e293b;">Project</strong>&nbsp;&nbsp;
                        ${escapeHtml(projectName)}
                      </span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>` : ''}

            <!-- Status row -->
            <tr>
              <td style="padding:4px 0;vertical-align:top;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td valign="top" style="padding-right:8px;">
                      <!-- Circle icon -->
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
                           xmlns="http://www.w3.org/2000/svg"
                           style="display:block;margin-top:1px;">
                        <circle cx="7" cy="7" r="6" stroke="#f59e0b" stroke-width="1.3"/>
                        <circle cx="7" cy="7" r="3" fill="#f59e0b"/>
                      </svg>
                    </td>
                    <td>
                      <span style="font-family:-apple-system,BlinkMacSystemFont,
                                               'SF Pro Text','Segoe UI',Arial,sans-serif;
                                   font-size:13px;color:#334155;line-height:1.5;">
                        <strong style="color:#1e293b;">Status</strong>&nbsp;&nbsp;
                        <span style="color:#d97706;">Not completed</span>
                      </span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>

    <!-- ══ CTA ═══════════════════════════════════════════════════════════ -->
    ${buildNotifCta(`${appUrl}/app/tasks`, 'Open LifeFlow')}
    ${notifFooter(appUrl)}
  `)

  // Recurrence + project lines for plain-text
  const extraLines: string[] = []
  if (recurrenceLabel) extraLines.push(`Recurrence:   ${recurrenceLabel}`)
  if (projectName)     extraLines.push(`Project:      ${projectName}`)
  if (priority)        extraLines.push(`Priority:     ${priority.charAt(0).toUpperCase() + priority.slice(1)}`)

  const text = [
    `Task reminder: ${taskTitle}`,
    ``,
    `Hi ${firstName}, your task is due in 30 minutes.`,
    ``,
    `TASK`,
    `  ${taskTitle}`,
    ``,
    `Due:          ${dueLabel}`,
    ...extraLines,
    `Status:       Not completed`,
    ``,
    `Open LifeFlow: ${appUrl}/app/tasks`,
    ``,
    `Manage notification preferences: ${appUrl}/app/profile`,
  ].join('\n')

  return { subject, html, text }
}

// ─── Test notification (activation flow) ─────────────────────────────────────

export interface TestNotificationEmailOptions {
  toName:  string
  appUrl:  string
}

/**
 * One-time test email sent to confirm notification delivery before activating
 * the regular scheduled notification flow.
 *
 * Design goals:
 *  - Matches the LifeFlow branded shell used by all other notification emails.
 *  - Single clear message: "Notifications are working."
 *  - No external resources, no tracking, no marketing language.
 *  - Table-based layout for Outlook/Gmail/Apple Mail compatibility.
 */
export function buildTestNotificationEmail(opts: TestNotificationEmailOptions): {
  subject: string
  html:    string
  text:    string
} {
  const { toName, appUrl } = opts
  const firstName = toName.split(' ')[0] ?? toName

  const subject = `LifeFlow notifications are active ✓`

  const html = wrapHtml(`
    <!-- ══ Check icon ════════════════════════════════════════════════════ -->
    <!--
      Gmail strips display:inline-flex from <div> elements, which caused the
      SVG checkmark to disappear and leave only a plain blue circle.  Fix:
      use a single self-contained SVG that draws its own circle + checkmark so
      it renders as one atomic unit regardless of whether outer CSS survives.
      The table wrapper provides Gmail-safe horizontal centering.
    -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"
           align="center" width="100%" style="margin:0 0 20px;">
      <tr>
        <td align="center">
          <svg width="60" height="60" viewBox="0 0 60 60"
               xmlns="http://www.w3.org/2000/svg"
               role="img" aria-label="Success checkmark">
            <!-- Blue circle background -->
            <circle cx="30" cy="30" r="30" fill="#2563eb"/>
            <!-- White checkmark: M 15,31  L 25,41  L 45,19 -->
            <polyline points="15,31 25,41 45,19"
                      fill="none"
                      stroke="#ffffff"
                      stroke-width="4"
                      stroke-linecap="round"
                      stroke-linejoin="round"/>
          </svg>
        </td>
      </tr>
    </table>

    <!-- ══ Heading ═══════════════════════════════════════════════════════ -->
    <h2 style="margin:0 0 6px;
               font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display',
                            'Segoe UI',Arial,sans-serif;
               font-size:22px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;
               text-align:center;">
      Notifications are active
    </h2>
    <p style="margin:0 0 28px;
              font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                           'Segoe UI',Arial,sans-serif;
              font-size:13px;color:#64748b;text-align:center;">
      Hi ${escapeHtml(firstName)}, your LifeFlow email notifications are confirmed and ready.
    </p>

    <!-- ══ Info card ═════════════════════════════════════════════════════ -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"
           width="100%"
           style="margin:0 0 28px;
                  border:1px solid #dce3ef;
                  border-left:4px solid #2563eb;
                  border-radius:12px;
                  background-color:#f8faff;
                  box-shadow:0 1px 4px rgba(15,23,42,0.06);">
      <tr>
        <td style="padding:18px 20px;">
          <p style="margin:0 0 10px;
                    font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                                 'Segoe UI',Arial,sans-serif;
                    font-size:13px;font-weight:600;color:#1e293b;">
            What happens next
          </p>
          <ul style="margin:0;padding-left:18px;
                     font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                                  'Segoe UI',Arial,sans-serif;
                     font-size:13px;line-height:1.8;color:#475569;">
            <li>Task reminders — 30 minutes before each due time</li>
            <li>Today&rsquo;s unfinished tasks — 7&nbsp;PM in your timezone</li>
            <li>Tomorrow&rsquo;s preview — 10&nbsp;PM in your timezone</li>
            <li>Daily summary — 11:55&nbsp;PM in your timezone</li>
            <li>Weekly summary — every Sunday at 10&nbsp;PM</li>
          </ul>
        </td>
      </tr>
    </table>

    <!-- ══ CTA button ════════════════════════════════════════════════════ -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"
           align="center" style="margin:0 auto 8px;">
      <tr>
        <td align="center" style="border-radius:10px;
                                   background:linear-gradient(135deg,#2563eb 0%,#1d4ed8 100%);
                                   box-shadow:0 4px 14px rgba(37,99,235,0.35);">
          <a href="${appUrl}/app/profile"
             style="display:inline-block;padding:13px 32px;
                    font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                                 'Segoe UI',Arial,sans-serif;
                    font-size:14px;font-weight:600;color:#ffffff;
                    text-decoration:none;letter-spacing:-0.1px;
                    white-space:nowrap;">
            Open LifeFlow &rarr;
          </a>
        </td>
      </tr>
    </table>
  `)

  const text = [
    `LifeFlow — Notifications active`,
    ``,
    `Hi ${firstName},`,
    ``,
    `Your LifeFlow email notifications are confirmed and active.`,
    ``,
    `You will now automatically receive:`,
    `  • Task reminders — 30 minutes before each due time`,
    `  • Today's unfinished tasks — 7 PM in your timezone`,
    `  • Tomorrow's preview — 10 PM in your timezone`,
    `  • Daily summary — 11:55 PM in your timezone`,
    `  • Weekly summary — every Sunday at 10 PM`,
    ``,
    `Manage notification preferences: ${appUrl}/app/profile`,
    ``,
    `— The LifeFlow Team`,
  ].join('\n')

  return { subject, html, text }
}

// ─── Morning daily brief (7:00 AM) ───────────────────────────────────────────

export interface MorningBriefEmailOptions {
  /** Recipient's display name */
  toName: string
  /** Human-readable date label e.g. "Thursday, 17 Sep" */
  todayLabel: string
  /** Formatted scheduled time label e.g. "7:00 AM" */
  scheduledTimeLabel: string
  /** Number of tasks due today (incomplete) */
  taskCount: number
  /** Up to 5 task titles */
  taskTitles: string[]
  /** Number of already-completed tasks today */
  completedTaskCount: number
  /** Number of habits remaining to complete today */
  habitCount: number
  /** Up to 5 habit names with emoji */
  habitNames: string[]
  /** Up to 3 active goal titles */
  goalTitles: string[]
  /** Total active goals */
  totalGoals: number
  /** App base URL */
  appUrl: string
}

/**
 * Build the "Today's LifeFlow" morning daily brief email.
 *
 * Sent automatically at 7:00 AM in each user's local timezone.
 * Only sent to users where:
 *   • notificationsTested === true
 *   • emailNotifications.enabled === true
 *   • emailNotifications.dailySummary === true
 *   • There is something relevant today (tasks OR habits OR goals)
 *
 * NOTIFICATION STATUS ICON
 * ──────────────────────────
 * The header uses a Wi-Fi-style signal / notification icon with:
 *   • Large circular outer arc
 *   • Centred Wi-Fi signal arcs (three concentric arcs)
 *   • Centred lower dot
 *   • Scheduled time displayed prominently below the icon
 * This conveys "scheduled notification delivered on time" at a glance.
 */
export function buildMorningBriefEmail(opts: MorningBriefEmailOptions): {
  subject: string
  html: string
  text: string
} {
  const {
    toName,
    todayLabel,
    scheduledTimeLabel,
    taskCount,
    taskTitles,
    completedTaskCount,
    habitCount,
    habitNames,
    goalTitles,
    totalGoals,
    appUrl,
  } = opts

  const firstName = toName.split(' ')[0] ?? toName
  const subject   = `Today's LifeFlow — ${todayLabel}`

  // ─── Section helpers ──────────────────────────────────────────────────────

  function sectionHeader(label: string): string {
    return `
      <p style="margin:0 0 4px;
                font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                             'Segoe UI',Arial,sans-serif;
                font-size:10.5px;font-weight:700;color:#94a3b8;
                text-transform:uppercase;letter-spacing:0.9px;">
        ${escapeHtml(label)}
      </p>`
  }

  function buildBriefSection(
    sectionLabel: string,
    count: number,
    items: string[],
    itemWord: string,
    ctaPath: string,
    emptyMsg?: string
  ): string {
    if (count === 0 && !emptyMsg) return ''
    return `
      ${sectionHeader(sectionLabel)}
      ${count > 0
        ? `${buildItemList(items)}
           ${count > items.length
             ? `<p style="margin:-12px 0 18px;
                          font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                                       'Segoe UI',Arial,sans-serif;
                          font-size:12px;color:#94a3b8;">
                  &hellip;and ${count - items.length} more ${escapeHtml(itemWord)}
                </p>`
             : `<p style="margin:-12px 0 18px;
                          font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                                       'Segoe UI',Arial,sans-serif;
                          font-size:12px;color:#94a3b8;">
                  <a href="${escapeHtml(appUrl + ctaPath)}"
                     style="color:#2563eb;text-decoration:none;">View in LifeFlow &rarr;</a>
                </p>`}`
        : `<p style="margin:0 0 18px;
                     font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                                  'Segoe UI',Arial,sans-serif;
                     font-size:13px;color:#94a3b8;font-style:italic;">
             ${escapeHtml(emptyMsg ?? '')}
           </p>`}
    `
  }

  const html = wrapHtml(`

    <!-- ══ Notification time icon ════════════════════════════════════════ -->
    <!--
      Time-based notification icon (replaces former Wi-Fi symbol):
        • Large circular outer arc, open at the bottom
        • Bottom dots (•  ●  •) below the gap
        • Scheduled time (HH:MM / AM or PM) in the center
      The Wi-Fi symbol has been removed entirely.
      Only the actual scheduled delivery time appears in the center.
    -->
    ${buildNotificationIconHtml(
      (() => { const t = parseIconTimeLabel(scheduledTimeLabel); return t.hhmm })(),
      (() => { const t = parseIconTimeLabel(scheduledTimeLabel); return t.ampm })(),
      '8px'
    )}

    <!-- "Daily Brief" label below the icon -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"
           width="100%" style="margin:0 0 28px;">
      <tr>
        <td align="center">
          <p style="margin:0;
                    font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                                 'Segoe UI',Arial,sans-serif;
                    font-size:11.5px;font-weight:600;color:#2563eb;
                    letter-spacing:0.7px;text-transform:uppercase;">
            Daily Brief
          </p>
        </td>
      </tr>
    </table>

    <!-- ══ Heading ═══════════════════════════════════════════════════════ -->
    <h2 style="margin:0 0 4px;
               font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display',
                            'Segoe UI',Arial,sans-serif;
               font-size:22px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;">
      Good morning, ${escapeHtml(firstName)}.
    </h2>
    <p style="margin:0 0 28px;
              font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                           'Segoe UI',Arial,sans-serif;
              font-size:13px;color:#64748b;">
      ${escapeHtml(todayLabel)}
    </p>

    ${completedTaskCount > 0 ? `
    <!-- Already-done nudge -->
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;
                padding:11px 16px;margin:0 0 24px;">
      <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                         'Segoe UI',Arial,sans-serif;
                font-size:13px;color:#15803d;line-height:1.55;">
        &#10003;&nbsp; You already completed
        <strong>${completedTaskCount}</strong>
        task${completedTaskCount === 1 ? '' : 's'} today. Keep it up!
      </p>
    </div>` : ''}

    <!-- ══ Tasks ══════════════════════════════════════════════════════════ -->
    ${buildBriefSection(
      'Tasks due today',
      taskCount,
      taskTitles,
      'tasks',
      '/app/tasks',
      'No tasks due today — enjoy your day!'
    )}

    <!-- ══ Habits ══════════════════════════════════════════════════════════ -->
    ${buildBriefSection(
      'Habits to complete',
      habitCount,
      habitNames,
      'habits',
      '/app/habits'
    )}

    <!-- ══ Goals ══════════════════════════════════════════════════════════ -->
    ${totalGoals > 0 ? `
    ${sectionHeader('Active goals')}
    ${buildItemList(goalTitles)}
    ${totalGoals > goalTitles.length
      ? `<p style="margin:-12px 0 18px;
                   font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                                'Segoe UI',Arial,sans-serif;
                   font-size:12px;color:#94a3b8;">
             &hellip;and ${totalGoals - goalTitles.length} more goals
           </p>`
      : `<p style="margin:-12px 0 18px;
                   font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                                'Segoe UI',Arial,sans-serif;
                   font-size:12px;color:#94a3b8;">
             <a href="${escapeHtml(appUrl + '/app/goals')}"
                style="color:#2563eb;text-decoration:none;">View all goals &rarr;</a>
           </p>`}
    ` : ''}

    <!-- ══ CTA ═══════════════════════════════════════════════════════════ -->
    ${buildNotifCta(`${appUrl}/app/dashboard`, 'Open LifeFlow')}
    ${notifFooter(appUrl)}
  `)

  // ─── Plain text version ────────────────────────────────────────────────────
  const textLines: string[] = [
    `Today's LifeFlow — ${todayLabel}`,
    `Scheduled: ${scheduledTimeLabel} (Daily Brief)`,
    ``,
    `Good morning, ${firstName}.`,
    ``,
  ]

  if (completedTaskCount > 0) {
    textLines.push(`✓ ${completedTaskCount} task${completedTaskCount === 1 ? '' : 's'} already completed today.`, ``)
  }

  if (taskCount > 0) {
    textLines.push(`TASKS DUE TODAY (${taskCount})`)
    taskTitles.forEach((t) => textLines.push(`  • ${t}`))
    if (taskCount > taskTitles.length) textLines.push(`  … and ${taskCount - taskTitles.length} more`)
    textLines.push(``)
  } else {
    textLines.push(`TASKS`, `  No tasks due today.`, ``)
  }

  if (habitCount > 0) {
    textLines.push(`HABITS TO COMPLETE (${habitCount})`)
    habitNames.forEach((h) => textLines.push(`  • ${h}`))
    if (habitCount > habitNames.length) textLines.push(`  … and ${habitCount - habitNames.length} more`)
    textLines.push(``)
  }

  if (totalGoals > 0) {
    textLines.push(`ACTIVE GOALS (${totalGoals})`)
    goalTitles.forEach((g) => textLines.push(`  • ${g}`))
    if (totalGoals > goalTitles.length) textLines.push(`  … and ${totalGoals - goalTitles.length} more`)
    textLines.push(``)
  }

  textLines.push(
    `Open LifeFlow: ${appUrl}/app/dashboard`,
    ``,
    `Manage notification preferences: ${appUrl}/app/profile`,
  )

  return { subject, html, text: textLines.join('\n') }
}

// ─── Account deletion scheduled ───────────────────────────────────────────────

export interface AccountDeletedEmailOptions {
  toName: string
  toEmail: string
  /** ISO string of soft-deletion timestamp */
  deletedAt: string
  /** ISO string of scheduled permanent-deletion date */
  scheduledPermanentDeletionAt: string
  appUrl: string
  /**
   * Full restoration URL containing the secure single-use token.
   * Format: `${appUrl}/restore-account?token=<base64url-token>`
   * The raw token is generated by the delete-account route and must never be
   * logged.  Pass the complete URL so this template stays token-unaware.
   */
  restoreUrl: string
}

/**
 * Confirmation email sent once after an account is soft-deleted.
 * Tells the user what was done, when permanent deletion will occur,
 * and how to restore their account within the 30-day window.
 */
export function buildAccountDeletedEmail(opts: AccountDeletedEmailOptions): {
  subject: string
  html: string
  text: string
} {
  const { toName, toEmail: _toEmail, deletedAt, scheduledPermanentDeletionAt, appUrl: _appUrl, restoreUrl } = opts
  // _toEmail and _appUrl are part of the interface for caller completeness but are not
  // rendered directly — all display content is derived from other fields or restoreUrl.
  const firstName = toName.split(' ')[0] ?? toName

  // Format dates for display — e.g. "September 17, 2026"
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    })
  const deletedDateStr    = fmt(deletedAt)
  const permanentDateStr  = fmt(scheduledPermanentDeletionAt)
  // restoreUrl is supplied by the caller — it contains the secure single-use
  // token and must never be reconstructed here.

  const subject = `Restore your ${BRAND_NAME} account`

  const html = wrapHtml(`
    <h2 style="margin:0 0 8px;
               font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display',
                            'SF Pro Text','Segoe UI',Arial,sans-serif;
               font-size:22px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;">
      Restore your ${BRAND_NAME} account
    </h2>
    <p style="margin:0 0 16px;
              font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                           'Segoe UI',Arial,sans-serif;
              font-size:15px;color:#334155;line-height:1.65;">
      Hi ${escapeHtml(firstName)},
    </p>
    <p style="margin:0 0 20px;
              font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                           'Segoe UI',Arial,sans-serif;
              font-size:15px;color:#334155;line-height:1.65;">
      Your ${BRAND_NAME} account has been scheduled for deletion.
      Your account and data are currently preserved.
      You can restore your account before the permanent deletion date.
    </p>

    <!-- Info box -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
           style="margin:0 0 24px;">
      <tr>
        <td style="background:#fefce8;border:1px solid #fde047;border-radius:10px;
                   padding:16px 18px;">
          <p style="margin:0 0 8px;
                    font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                                 'Segoe UI',Arial,sans-serif;
                    font-size:13.5px;font-weight:600;color:#713f12;">
            &#128337;&nbsp; Your account timeline
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                                      'Segoe UI',Arial,sans-serif;
                         font-size:13px;color:#78350f;padding:2px 10px 2px 0;
                         white-space:nowrap;font-weight:600;">
                Account deleted
              </td>
              <td style="font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                                      'Segoe UI',Arial,sans-serif;
                         font-size:13px;color:#92400e;padding:2px 0;">
                ${escapeHtml(deletedDateStr)}
              </td>
            </tr>
            <tr>
              <td style="font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                                      'Segoe UI',Arial,sans-serif;
                         font-size:13px;color:#78350f;padding:2px 10px 2px 0;
                         white-space:nowrap;font-weight:600;">
                Permanent deletion
              </td>
              <td style="font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                                      'Segoe UI',Arial,sans-serif;
                         font-size:13px;color:#92400e;padding:2px 0;">
                ${escapeHtml(permanentDateStr)}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <p style="margin:0 0 20px;
              font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                           'Segoe UI',Arial,sans-serif;
              font-size:15px;color:#334155;line-height:1.65;">
      You can restore your account before <strong>${escapeHtml(permanentDateStr)}</strong>.
      All your tasks, habits, goals, expenses, notes, and preferences will be exactly as you left them.
    </p>

    <!-- CTA — single-use secure restore link -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"
           style="margin:0 0 24px;">
      <tr>
        <td style="border-radius:10px;background:#2563eb;">
          <a href="${escapeHtml(restoreUrl)}"
             class="btn-cta"
             style="display:inline-block;padding:13px 28px;
                    font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                                 'Segoe UI',Arial,sans-serif;
                    font-size:14px;font-weight:600;color:#ffffff;
                    text-decoration:none;border-radius:10px;
                    mso-padding-alt:0;line-height:1;">
            Restore My Account
          </a>
        </td>
      </tr>
    </table>

    <p style="margin:0 0 8px;
              font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                           'Segoe UI',Arial,sans-serif;
              font-size:12px;color:#94a3b8;line-height:1.65;">
      This link is single-use and expires on <strong style="color:#64748b;">${escapeHtml(permanentDateStr)}</strong>.
      Do not share it with anyone.
    </p>
    <p style="margin:0 0 16px;
              font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                           'Segoe UI',Arial,sans-serif;
              font-size:13px;color:#64748b;line-height:1.65;">
      After <strong>${escapeHtml(permanentDateStr)}</strong>, your account and all
      associated data will be permanently and irreversibly deleted. This cannot be undone.
    </p>
    <p style="margin:0;
              font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                           'Segoe UI',Arial,sans-serif;
              font-size:13px;color:#94a3b8;line-height:1.65;">
      If you did not request this deletion, please restore your account immediately
      and then change your password.
    </p>
  `)

  const text =
    `Restore your ${BRAND_NAME} account\n\n` +
    `Hi ${firstName},\n\n` +
    `Your ${BRAND_NAME} account has been scheduled for deletion.\n` +
    `Your account and data are currently preserved.\n` +
    `You can restore your account before the permanent deletion date.\n\n` +
    `Account deleted:     ${deletedDateStr}\n` +
    `Permanent deletion:  ${permanentDateStr}\n\n` +
    `Restore your account before ${permanentDateStr} by visiting:\n` +
    `${restoreUrl}\n\n` +
    `This link is single-use and expires on ${permanentDateStr}.\n\n` +
    `All your tasks, habits, goals, expenses, notes, and preferences will be exactly as you left them.\n\n` +
    `After ${permanentDateStr}, your account and all data will be permanently and irreversibly deleted.\n\n` +
    `If you did not request this deletion, restore your account immediately and then change your password.\n\n` +
    `— The ${BRAND_NAME} Team`

  return { subject, html, text }
}

// ─── Account restored ─────────────────────────────────────────────────────────

export interface AccountRestoredEmailOptions {
  toName: string
  toEmail: string
  appUrl: string
}

/**
 * Confirmation email sent once after a soft-deleted account is successfully restored.
 */
export function buildAccountRestoredEmail(opts: AccountRestoredEmailOptions): {
  subject: string
  html: string
  text: string
} {
  const { toName, toEmail, appUrl } = opts
  const firstName  = toName.split(' ')[0] ?? toName
  const dashUrl    = `${appUrl}/app/dashboard`

  const subject = `Your ${BRAND_NAME} account has been restored`

  const html = wrapHtml(`
    <h2 style="margin:0 0 8px;
               font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display',
                            'SF Pro Text','Segoe UI',Arial,sans-serif;
               font-size:22px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;">
      Your account has been restored
    </h2>
    <p style="margin:0 0 16px;
              font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                           'Segoe UI',Arial,sans-serif;
              font-size:15px;color:#334155;line-height:1.65;">
      Hi ${escapeHtml(firstName)},
    </p>
    <p style="margin:0 0 20px;
              font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                           'Segoe UI',Arial,sans-serif;
              font-size:15px;color:#334155;line-height:1.65;">
      Great news — your ${BRAND_NAME} account
      (<strong>${escapeHtml(toEmail)}</strong>) has been fully restored.
      All your data is intact and exactly as you left it.
    </p>

    <!-- Success box -->
    <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:10px;
                padding:14px 16px;margin:0 0 24px;">
      <p style="margin:0;
                font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                             'Segoe UI',Arial,sans-serif;
                font-size:13.5px;color:#166534;line-height:1.65;">
        <strong>&#10003;</strong>&nbsp; Your tasks, habits, goals, expenses, notes,
        and preferences have all been preserved.
      </p>
    </div>

    <!-- CTA -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"
           style="margin:0 0 24px;">
      <tr>
        <td style="border-radius:10px;background:#2563eb;">
          <a href="${dashUrl}"
             class="btn-cta"
             style="display:inline-block;padding:13px 28px;
                    font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                                 'Segoe UI',Arial,sans-serif;
                    font-size:14px;font-weight:600;color:#ffffff;
                    text-decoration:none;border-radius:10px;
                    mso-padding-alt:0;line-height:1;">
            Open LifeFlow
          </a>
        </td>
      </tr>
    </table>

    <p style="margin:0;
              font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                           'Segoe UI',Arial,sans-serif;
              font-size:13px;color:#64748b;line-height:1.65;">
      If you did not request this restoration, please change your password
      immediately and contact support.
    </p>
  `)

  const text =
    `Your ${BRAND_NAME} account has been restored\n\n` +
    `Hi ${firstName},\n\n` +
    `Your ${BRAND_NAME} account (${toEmail}) has been fully restored.\n\n` +
    `All your tasks, habits, goals, expenses, notes, and preferences are intact.\n\n` +
    `Open LifeFlow: ${dashUrl}\n\n` +
    `If you did not request this restoration, please change your password immediately.\n\n` +
    `— The ${BRAND_NAME} Team`

  return { subject, html, text }
}

// ─── Email masking utility ────────────────────────────────────────────────────

/**
 * Mask an email address for safe display in recovery UIs.
 *
 * Rules:
 *   • Keep the first 2 characters of the local part.
 *   • Replace everything between those 2 chars and the '@' with asterisks.
 *   • For very short local parts (≤ 3 chars) keep first + last char only,
 *     replacing the middle with a single '*' so the result is still ≥ 3 chars.
 *   • The domain portion is never masked.
 *
 * Examples:
 *   kindikeris@gmail.com  → ki*********@gmail.com
 *   abc@gmail.com         → a*c@gmail.com
 *   ab@mail.com           → a*@mail.com
 *   a@mail.com            → a@mail.com   (nothing to mask)
 */
export function maskEmail(email: string): string {
  const atIdx = email.indexOf('@')
  if (atIdx <= 0) return email          // malformed — return as-is

  const local  = email.slice(0, atIdx)
  const domain = email.slice(atIdx)     // includes '@'

  if (local.length <= 1) return email   // single char — nothing to mask
  if (local.length === 2) return `${local[0]}*${domain}`
  if (local.length === 3) return `${local[0]}*${local[2]}${domain}`

  // 4+ chars: keep first 2, mask the rest
  const visible = local.slice(0, 2)
  const masked  = '*'.repeat(local.length - 2)
  return `${visible}${masked}${domain}`
}

// ─── Account recovery OTP email ───────────────────────────────────────────────

export interface AccountRecoveryOtpEmailOptions {
  toName: string
  /** The registered email address — also the recipient. */
  toEmail: string
  /** Raw 6-digit OTP to display in the email.  Never log this value. */
  otp: string
  /** OTP validity in minutes (typically 10). */
  validMinutes: number
}

/**
 * Transactional email containing the 6-digit OTP for the second step of
 * account recovery (password → OTP → restore).
 *
 * Security notes:
 *   • The otp value is rendered only inside the HTML/text body and is never
 *     stored or logged by this function.
 *   • The caller is responsible for NOT logging the otp after calling this.
 *   • The masked email shown in the subject/body is derived from toEmail
 *     inside this function — the full address is never displayed to a
 *     third-party observer of the email content.
 */
export function buildAccountRecoveryOtpEmail(opts: AccountRecoveryOtpEmailOptions): {
  subject: string
  html: string
  text: string
} {
  const { toName, toEmail, otp, validMinutes } = opts
  const firstName   = toName.split(' ')[0] ?? toName
  const maskedEmail = maskEmail(toEmail)

  const subject = `LifeFlow account recovery verification`

  const html = wrapHtml(`
    <h2 style="margin:0 0 8px;
               font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display',
                            'SF Pro Text','Segoe UI',Arial,sans-serif;
               font-size:22px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;">
      Verify your email
    </h2>
    <p style="margin:0 0 16px;
              font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                           'Segoe UI',Arial,sans-serif;
              font-size:15px;color:#334155;line-height:1.65;">
      Hi ${escapeHtml(firstName)},
    </p>
    <p style="margin:0 0 20px;
              font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                           'Segoe UI',Arial,sans-serif;
              font-size:15px;color:#334155;line-height:1.65;">
      Someone is attempting to restore your ${BRAND_NAME} account.
      We received a request to verify your identity before restoring access.
    </p>

    <!-- OTP display box -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
           style="margin:0 0 24px;">
      <tr>
        <td style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;
                   padding:24px 18px;text-align:center;">
          <p style="margin:0 0 8px;
                    font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                                 'Segoe UI',Arial,sans-serif;
                    font-size:12px;font-weight:600;color:#64748b;
                    text-transform:uppercase;letter-spacing:0.08em;">
            Your verification code
          </p>
          <p style="margin:0;
                    font-family:'SF Mono','Fira Code','Fira Mono','Roboto Mono',
                                 'Courier New',monospace;
                    font-size:38px;font-weight:700;color:#0f172a;
                    letter-spacing:0.22em;line-height:1.1;">
            ${escapeHtml(otp)}
          </p>
          <p style="margin:10px 0 0;
                    font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                                 'Segoe UI',Arial,sans-serif;
                    font-size:12px;color:#94a3b8;line-height:1.5;">
            Expires in ${escapeHtml(String(validMinutes))} minutes
          </p>
        </td>
      </tr>
    </table>

    <!-- Info / warning box -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
           style="margin:0 0 20px;">
      <tr>
        <td style="background:#fefce8;border:1px solid #fde047;border-radius:10px;
                   padding:14px 16px;">
          <p style="margin:0;
                    font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                                 'Segoe UI',Arial,sans-serif;
                    font-size:13px;color:#78350f;line-height:1.65;">
            <strong>&#9888;&nbsp; Do not share this code.</strong>
            ${BRAND_NAME} will never ask you for this code.
            If you did not request account recovery, you can safely ignore this email —
            your account will not be restored without this code.
          </p>
        </td>
      </tr>
    </table>

    <p style="margin:0;
              font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                           'Segoe UI',Arial,sans-serif;
              font-size:13px;color:#94a3b8;line-height:1.65;">
      This code was sent to
      <strong style="color:#64748b;">${escapeHtml(maskedEmail)}</strong>
      and is valid for ${escapeHtml(String(validMinutes))} minutes.
      It can only be used once.
    </p>
  `)

  const text =
    `LifeFlow account recovery verification\n\n` +
    `Hi ${firstName},\n\n` +
    `Someone is attempting to restore your ${BRAND_NAME} account.\n\n` +
    `Your verification code is: ${otp}\n\n` +
    `This code expires in ${validMinutes} minutes and can only be used once.\n\n` +
    `Do not share this code with anyone.\n` +
    `${BRAND_NAME} will never ask you for this code.\n\n` +
    `If you did not request account recovery, you can safely ignore this email.\n` +
    `Your account will not be restored without this code.\n\n` +
    `— The ${BRAND_NAME} Team`

  return { subject, html, text }
}

// ─── Email OTP 2FA shared helper ─────────────────────────────────────────────

/**
 * Build the shared inner HTML block used by all three Email OTP 2FA emails
 * (enable, login, disable / security verification).
 *
 * @param headingText  — e.g. "Your LifeFlow 2FA verification code"
 * @param bodyText     — sentence shown above the OTP box
 * @param otp          — raw 6-digit OTP string.  Never log this value.
 * @param validMinutes — OTP lifetime (always 10 in production)
 * @param maskedEmail  — already-masked address, e.g. "ki*********@gmail.com"
 */
function buildOtpInnerHtml(
  headingText: string,
  bodyText: string,
  otp: string,
  validMinutes: number,
  maskedEmail: string,
): string {
  return `
    <h2 style="margin:0 0 8px;
               font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display',
                            'SF Pro Text','Segoe UI',Arial,sans-serif;
               font-size:22px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;">
      ${escapeHtml(headingText)}
    </h2>
    <p style="margin:0 0 20px;
              font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                           'Segoe UI',Arial,sans-serif;
              font-size:15px;color:#334155;line-height:1.65;">
      ${escapeHtml(bodyText)}
    </p>

    <!-- OTP display box -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
           style="margin:0 0 24px;">
      <tr>
        <td style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;
                   padding:24px 18px;text-align:center;">
          <p style="margin:0 0 8px;
                    font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                                 'Segoe UI',Arial,sans-serif;
                    font-size:12px;font-weight:600;color:#64748b;
                    text-transform:uppercase;letter-spacing:0.08em;">
            Your verification code
          </p>
          <p style="margin:0;
                    font-family:'SF Mono','Fira Code','Fira Mono','Roboto Mono',
                                 'Courier New',monospace;
                    font-size:38px;font-weight:700;color:#0f172a;
                    letter-spacing:0.22em;line-height:1.1;">
            ${escapeHtml(otp)}
          </p>
          <p style="margin:10px 0 0;
                    font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                                 'Segoe UI',Arial,sans-serif;
                    font-size:12px;color:#94a3b8;line-height:1.5;">
            Expires in ${escapeHtml(String(validMinutes))} minutes &bull; Single use
          </p>
        </td>
      </tr>
    </table>

    <!-- Warning box -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
           style="margin:0 0 20px;">
      <tr>
        <td style="background:#fefce8;border:1px solid #fde047;border-radius:10px;
                   padding:14px 16px;">
          <p style="margin:0;
                    font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                                 'Segoe UI',Arial,sans-serif;
                    font-size:13px;color:#78350f;line-height:1.65;">
            <strong>&#9888;&nbsp; Never share this code.</strong>
            ${BRAND_NAME} will never ask you for this code.
            If this wasn&rsquo;t you, secure your account immediately.
          </p>
        </td>
      </tr>
    </table>

    <p style="margin:0;
              font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',
                           'Segoe UI',Arial,sans-serif;
              font-size:13px;color:#94a3b8;line-height:1.65;">
      This code was sent to
      <strong style="color:#64748b;">${escapeHtml(maskedEmail)}</strong>
      and is valid for ${escapeHtml(String(validMinutes))} minutes.
      It can only be used once.
    </p>
  `
}

// ─── 2FA enable OTP email ─────────────────────────────────────────────────────

export interface TwoFaOtpEmailOptions {
  toName: string
  /** The registered email address — also the recipient. */
  toEmail: string
  /** Raw 6-digit OTP.  Put in email only; discard after.  Never log. */
  otp: string
  /** OTP validity in minutes (always 10). */
  validMinutes: number
}

/**
 * Email OTP 2FA enable flow — sent when the user requests to enable Email 2FA
 * after successfully verifying their account password.
 *
 * Subject: "Your LifeFlow 2FA verification code"
 */
export function buildTwoFaEnableOtpEmail(opts: TwoFaOtpEmailOptions): {
  subject: string
  html: string
  text: string
} {
  const { toName, toEmail, otp, validMinutes } = opts
  const firstName   = toName.split(' ')[0] ?? toName
  const maskedEmail = maskEmail(toEmail)

  const subject = `Your ${BRAND_NAME} 2FA verification code`

  const html = wrapHtml(
    buildOtpInnerHtml(
      'Enable two-factor authentication',
      `Hi ${firstName}, use the code below to complete enabling Email 2FA on your ${BRAND_NAME} account.`,
      otp,
      validMinutes,
      maskedEmail,
    )
  )

  const text =
    `Your ${BRAND_NAME} 2FA verification code\n\n` +
    `Hi ${firstName},\n\n` +
    `Use the code below to enable Email two-factor authentication on your ${BRAND_NAME} account.\n\n` +
    `Your verification code is: ${otp}\n\n` +
    `This code expires in ${validMinutes} minutes and can only be used once.\n\n` +
    `Never share this code. ${BRAND_NAME} will never ask you for it.\n` +
    `If this wasn't you, someone may be trying to modify your account settings.\n\n` +
    `— The ${BRAND_NAME} Team`

  return { subject, html, text }
}

// ─── 2FA login OTP email ──────────────────────────────────────────────────────

/**
 * Email OTP 2FA login flow — sent after correct password when emailOtpEnabled=true.
 *
 * Subject: "Your LifeFlow login verification code"
 */
export function buildTwoFaLoginOtpEmail(opts: TwoFaOtpEmailOptions): {
  subject: string
  html: string
  text: string
} {
  const { toName, toEmail, otp, validMinutes } = opts
  const firstName   = toName.split(' ')[0] ?? toName
  const maskedEmail = maskEmail(toEmail)

  const subject = `Your ${BRAND_NAME} login verification code`

  const html = wrapHtml(
    buildOtpInnerHtml(
      'Verify your identity',
      `Hi ${firstName}, someone is signing in to your ${BRAND_NAME} account. Use the code below to complete sign-in.`,
      otp,
      validMinutes,
      maskedEmail,
    )
  )

  const text =
    `Your ${BRAND_NAME} login verification code\n\n` +
    `Hi ${firstName},\n\n` +
    `Someone is signing in to your ${BRAND_NAME} account.\n\n` +
    `Your verification code is: ${otp}\n\n` +
    `This code expires in ${validMinutes} minutes and can only be used once.\n\n` +
    `Never share this code. ${BRAND_NAME} will never ask you for it.\n` +
    `If this wasn't you, change your password immediately.\n\n` +
    `— The ${BRAND_NAME} Team`

  return { subject, html, text }
}

// ─── 2FA disable / security verification OTP email ───────────────────────────

/**
 * Email OTP 2FA disable flow — sent when the user requests to disable Email 2FA
 * after successfully verifying their account password.
 *
 * Subject: "Your LifeFlow security verification code"
 */
export function buildTwoFaDisableOtpEmail(opts: TwoFaOtpEmailOptions): {
  subject: string
  html: string
  text: string
} {
  const { toName, toEmail, otp, validMinutes } = opts
  const firstName   = toName.split(' ')[0] ?? toName
  const maskedEmail = maskEmail(toEmail)

  const subject = `Your ${BRAND_NAME} security verification code`

  const html = wrapHtml(
    buildOtpInnerHtml(
      'Disable two-factor authentication',
      `Hi ${firstName}, use the code below to confirm disabling Email 2FA on your ${BRAND_NAME} account.`,
      otp,
      validMinutes,
      maskedEmail,
    )
  )

  const text =
    `Your ${BRAND_NAME} security verification code\n\n` +
    `Hi ${firstName},\n\n` +
    `Use the code below to confirm disabling Email two-factor authentication on your ${BRAND_NAME} account.\n\n` +
    `Your verification code is: ${otp}\n\n` +
    `This code expires in ${validMinutes} minutes and can only be used once.\n\n` +
    `Never share this code. ${BRAND_NAME} will never ask you for it.\n` +
    `If this wasn't you, your account may be at risk — change your password immediately.\n\n` +
    `— The ${BRAND_NAME} Team`

  return { subject, html, text }
}

// ─── Group Bill Reminder ──────────────────────────────────────────────────────

export interface GroupBillReminderPerson {
  displayName:  string
  billCount:    number
  /** Net amount (positive = they owe you, negative = you owe them). */
  netBalance:   number
  /** Direction: 'owes_you' | 'you_owe' */
  direction:    'owes_you' | 'you_owe'
  /** Currency code for the largest bill, used for symbol lookup. */
  currency:     string
  /** Per-bill lines for this person. */
  bills: Array<{
    billName:      string
    billDate:      string
    owesYouAmount: number
    youOweAmount:  number
  }>
}

export interface GroupBillReminderEmailOptions {
  toName:           string
  todayLabel:       string
  people:           GroupBillReminderPerson[]
  /** Sum of all owes-you net balances. */
  totalOwedToYou:   number
  /** Sum of all you-owe net balances. */
  totalYouOwe:      number
  appUrl:           string
  currencySymbol:   string
}

/**
 * Build the Group Bill Reminder email.
 *
 * Shows the bill owner a consolidated view of all outstanding balances:
 *   - People who owe them
 *   - People they owe
 * With a per-person drill-down of contributing bills.
 *
 * SERVER-ONLY. Never import from client components.
 */
export function buildGroupBillReminderEmail(
  opts: GroupBillReminderEmailOptions,
): { subject: string; html: string; text: string } {
  const {
    toName,
    todayLabel,
    people,
    totalOwedToYou,
    totalYouOwe,
    appUrl,
    currencySymbol,
  } = opts

  const firstName = toName.split(' ')[0] ?? toName
  const sym = currencySymbol

  const subject = `LifeFlow Group Bill Reminder — ${todayLabel}`

  // ── Helper: format amount ─────────────────────────────────────────────────
  function fmt(amount: number): string {
    return `${sym}${Math.abs(amount).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`
  }

  // ── Build person rows HTML ────────────────────────────────────────────────
  function personRowHtml(p: GroupBillReminderPerson): string {
    const isOwesYou   = p.direction === 'owes_you'
    const amountColor = isOwesYou ? '#16a34a' : '#dc2626'
    const dirLabel    = isOwesYou ? 'Owes You' : 'You Owe'
    const netAmt      = fmt(Math.abs(p.netBalance))

    const billLines = p.bills
      .slice(0, 5)
      .map((b) => {
        const amt = isOwesYou ? b.owesYouAmount : b.youOweAmount
        return `
          <tr>
            <td style="padding:4px 0 4px 16px;font-size:13px;color:#6b7280;">${b.billName}</td>
            <td style="padding:4px 0 4px 8px;font-size:13px;color:#6b7280;text-align:right;">${fmt(amt)}</td>
          </tr>`
      })
      .join('')

    const moreLabel =
      p.bills.length > 5
        ? `<tr><td colspan="2" style="padding:2px 0 2px 16px;font-size:11px;color:#9ca3af;">+${p.bills.length - 5} more bill(s)</td></tr>`
        : ''

    return `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;border-radius:10px;overflow:hidden;background:#f9fafb;border:1px solid #e5e7eb;">
      <tr>
        <td colspan="2" style="padding:12px 16px 8px 16px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td>
                <span style="font-size:15px;font-weight:600;color:#111827;">${p.displayName}</span>
                <span style="font-size:11px;color:#9ca3af;margin-left:8px;">${p.billCount} bill${p.billCount !== 1 ? 's' : ''}</span>
              </td>
              <td style="text-align:right;">
                <span style="font-size:12px;font-weight:500;color:${amountColor};background:${isOwesYou ? '#dcfce7' : '#fee2e2'};padding:2px 8px;border-radius:9999px;">${dirLabel}</span>
              </td>
            </tr>
            <tr>
              <td colspan="2" style="padding-top:2px;">
                <span style="font-size:18px;font-weight:700;color:${amountColor};">${netAmt}</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      ${billLines}
      ${moreLabel}
      <tr><td colspan="2" style="height:4px;"></td></tr>
    </table>`
  }

  const owesYouPeople = people.filter((p) => p.direction === 'owes_you')
  const youOwePeople  = people.filter((p) => p.direction === 'you_owe')

  const owesYouSection = owesYouPeople.length > 0
    ? `<h3 style="font-size:14px;font-weight:600;color:#15803d;margin:0 0 10px 0;padding-bottom:6px;border-bottom:1px solid #dcfce7;">
        ↙ Owed to You
       </h3>
       ${owesYouPeople.map(personRowHtml).join('')}`
    : ''

  const youOweSection = youOwePeople.length > 0
    ? `<h3 style="font-size:14px;font-weight:600;color:#b91c1c;margin:${owesYouPeople.length > 0 ? '20px' : '0'} 0 10px 0;padding-bottom:6px;border-bottom:1px solid #fee2e2;">
        ↗ You Owe
       </h3>
       ${youOwePeople.map(personRowHtml).join('')}`
    : ''

  const overviewRow = (label: string, amount: number, color: string) =>
    amount > 0
      ? `<tr>
           <td style="padding:6px 0;font-size:13px;color:#6b7280;">${label}</td>
           <td style="padding:6px 0;font-size:14px;font-weight:700;color:${color};text-align:right;">${fmt(amount)}</td>
         </tr>`
      : ''

  const inner = `
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;">

  <!-- Greeting -->
  <tr>
    <td style="padding:0 0 20px 0;">
      <p style="font-size:15px;color:#374151;margin:0;">Hi <strong>${firstName}</strong>,</p>
      <p style="font-size:15px;color:#374151;margin:12px 0 0 0;">
        Here's your Group Bill balance summary for <strong>${todayLabel}</strong>.
        You have outstanding balances with <strong>${people.length} person${people.length !== 1 ? 's' : ''}</strong>.
      </p>
    </td>
  </tr>

  <!-- Overview card -->
  <tr>
    <td style="padding:0 0 24px 0;">
      <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:12px;background:#f3f4f6;overflow:hidden;border:1px solid #e5e7eb;">
        <tr>
          <td style="padding:16px 20px;">
            <p style="font-size:12px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.05em;margin:0 0 10px 0;">Overview</p>
            <table width="100%" cellpadding="0" cellspacing="0">
              ${overviewRow('Owed to You',   totalOwedToYou, '#15803d')}
              ${overviewRow('You Owe Others', totalYouOwe,   '#b91c1c')}
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Per-person breakdown -->
  <tr>
    <td style="padding:0 0 4px 0;">
      ${owesYouSection}
      ${youOweSection}
    </td>
  </tr>

  <!-- CTA -->
  <tr>
    <td style="padding:24px 0 0 0;text-align:center;">
      <a href="${appUrl}/app/expenses"
         style="display:inline-block;background:#2563eb;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:12px 32px;border-radius:10px;">
        Open Group Bills
      </a>
    </td>
  </tr>

  <!-- Footer note -->
  <tr>
    <td style="padding:20px 0 0 0;">
      <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0;">
        Balances are recalculated live from your Group Bills.<br/>
        Mark a settlement as settled in LifeFlow to remove it from this summary.
      </p>
    </td>
  </tr>

</table>`

  const html = wrapHtml(inner)

  // ── Plain text ─────────────────────────────────────────────────────────────
  const owesYouText = owesYouPeople
    .map(
      (p) =>
        `  ${p.displayName} — ${fmt(Math.abs(p.netBalance))} (owes you)\n` +
        p.bills
          .slice(0, 5)
          .map((b) => `    • ${b.billName}: ${fmt(b.owesYouAmount)}`)
          .join('\n'),
    )
    .join('\n\n')

  const youOweText = youOwePeople
    .map(
      (p) =>
        `  ${p.displayName} — ${fmt(Math.abs(p.netBalance))} (you owe)\n` +
        p.bills
          .slice(0, 5)
          .map((b) => `    • ${b.billName}: ${fmt(b.youOweAmount)}`)
          .join('\n'),
    )
    .join('\n\n')

  const text =
    `LifeFlow Group Bill Reminder — ${todayLabel}\n\n` +
    `Hi ${firstName},\n\n` +
    `You have outstanding Group Bill balances with ${people.length} person${people.length !== 1 ? 's' : ''}.\n\n` +
    (totalOwedToYou > 0 ? `Total owed to you:   ${fmt(totalOwedToYou)}\n` : '') +
    (totalYouOwe    > 0 ? `Total you owe others: ${fmt(totalYouOwe)}\n`    : '') +
    '\n' +
    (owesYouPeople.length > 0
      ? `OWED TO YOU\n───────────\n${owesYouText}\n\n`
      : '') +
    (youOwePeople.length > 0
      ? `YOU OWE\n───────\n${youOweText}\n\n`
      : '') +
    `Open LifeFlow to settle: ${appUrl}/app/expenses\n\n` +
    `— The LifeFlow Team`

  return { subject, html, text }
}

// ─── Group Bill Manual Reminder — sent to the RECIPIENT by a bill owner ───────
//
// This is distinct from buildGroupBillReminderEmail(), which is a scheduled
// self-reminder sent to the bill OWNER.  This template is sent to another
// person (e.g. "Rahul") to inform them that they have outstanding Group Bills.
//
// Design goals:
//   • Shows ONLY the recipient's own outstanding balances (never other people's).
//   • Subject line mentions the outstanding amount so the recipient immediately
//     understands the purpose.
//   • Per-bill breakdown lets the recipient see exactly which bills contribute.
//   • CTA links to the LifeFlow Group Bills page (or a public landing page if
//     the recipient is not a LifeFlow user).
//   • No sensitive information about the sender's other contacts is exposed.
//
// SERVER-ONLY — never import from client components.

export interface GroupBillManualReminderBill {
  /** Human-readable bill name, e.g. "Dinner at Punjabi Dhaba". */
  billName: string
  /** Bill date in YYYY-MM-DD format. */
  billDate: string
  /** Amount this person owes on this specific bill (always positive). */
  amountOwed: number
}

export interface GroupBillManualReminderEmailOptions {
  /** Recipient's display name, e.g. "Rahul Kumar". */
  recipientName: string
  /** Sender's display name, e.g. "Priya Sharma". */
  senderName: string
  /**
   * Total outstanding amount across ALL Group Bills for this person.
   * Always positive — represents what the recipient owes the sender.
   */
  totalOutstanding: number
  /** Currency code, e.g. "INR". */
  currency: string
  /** Per-bill breakdown (up to 10 shown; more shown as "+N more"). */
  bills: GroupBillManualReminderBill[]
  /** App URL root, e.g. "https://lifeflow.app". */
  appUrl: string
}

/**
 * Build the manual Group Bill reminder email sent to the RECIPIENT.
 *
 * The subject includes the outstanding amount for urgency/context.
 * The body shows a per-bill breakdown and a CTA to open LifeFlow.
 *
 * SERVER-ONLY — never import from client components.
 */
export function buildGroupBillManualReminderEmail(
  opts: GroupBillManualReminderEmailOptions,
): { subject: string; html: string; text: string } {
  const { recipientName, senderName, totalOutstanding, currency, bills, appUrl } = opts

  const firstName = recipientName.split(' ')[0] ?? recipientName

  const currencySymbols: Record<string, string> = {
    INR: '₹', USD: '$', EUR: '€', GBP: '£', JPY: '¥',
  }
  const sym = currencySymbols[currency] ?? currency

  function fmt(amount: number): string {
    return `${sym}${Math.abs(amount).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`
  }

  const subject = `LifeFlow Group Bill Reminder — ${fmt(totalOutstanding)} outstanding`

  const visibleBills = bills.slice(0, 10)
  const extraCount   = bills.length - visibleBills.length

  // Build per-bill rows
  const billRowsHtml = visibleBills
    .map((b) => {
      const dateLabel = (() => {
        try {
          const [y, m, d] = b.billDate.split('-').map(Number)
          return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-IN', {
            day: 'numeric', month: 'short', year: 'numeric',
          })
        } catch {
          return b.billDate
        }
      })()
      return `
      <tr>
        <td style="padding:8px 16px;font-size:13px;color:#374151;border-bottom:1px solid #f3f4f6;">
          ${b.billName}
          <span style="display:block;font-size:11px;color:#9ca3af;margin-top:2px;">${dateLabel}</span>
        </td>
        <td style="padding:8px 16px;font-size:13px;font-weight:600;color:#dc2626;text-align:right;border-bottom:1px solid #f3f4f6;">
          ${fmt(b.amountOwed)}
        </td>
      </tr>`
    })
    .join('')

  const extraRowHtml = extraCount > 0
    ? `<tr>
        <td colspan="2" style="padding:8px 16px;font-size:11px;color:#9ca3af;">
          +${extraCount} more bill${extraCount !== 1 ? 's' : ''}
        </td>
       </tr>`
    : ''

  const inner = `
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;">

  <!-- Greeting -->
  <tr>
    <td style="padding:0 0 20px 0;">
      <p style="font-size:15px;color:#374151;margin:0 0 10px 0;">
        Hi <strong>${firstName}</strong>,
      </p>
      <p style="font-size:15px;color:#374151;margin:0;">
        <strong>${senderName}</strong> has sent you a Group Bill reminder.
        You have an outstanding balance on <strong>${bills.length} Group Bill${bills.length !== 1 ? 's' : ''}</strong>.
      </p>
    </td>
  </tr>

  <!-- Outstanding amount card -->
  <tr>
    <td style="padding:0 0 24px 0;">
      <table width="100%" cellpadding="0" cellspacing="0"
             style="border-radius:12px;background:#fef2f2;overflow:hidden;border:1px solid #fecaca;">
        <tr>
          <td style="padding:20px 24px;">
            <p style="font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;
                       letter-spacing:0.05em;margin:0 0 6px 0;">Total Outstanding</p>
            <p style="font-size:30px;font-weight:700;color:#dc2626;margin:0;
                       font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif;">
              ${fmt(totalOutstanding)}
            </p>
            <p style="font-size:12px;color:#9ca3af;margin:6px 0 0 0;">
              across ${bills.length} bill${bills.length !== 1 ? 's' : ''}
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Per-bill breakdown -->
  <tr>
    <td style="padding:0 0 24px 0;">
      <p style="font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;
                 letter-spacing:0.05em;margin:0 0 10px 0;">Your Outstanding Bills</p>
      <table width="100%" cellpadding="0" cellspacing="0"
             style="border-radius:10px;overflow:hidden;background:#ffffff;border:1px solid #e5e7eb;">
        <tr style="background:#f9fafb;">
          <th style="padding:8px 16px;font-size:11px;font-weight:600;color:#9ca3af;
                      text-align:left;border-bottom:1px solid #e5e7eb;">Bill</th>
          <th style="padding:8px 16px;font-size:11px;font-weight:600;color:#9ca3af;
                      text-align:right;border-bottom:1px solid #e5e7eb;">Amount</th>
        </tr>
        ${billRowsHtml}
        ${extraRowHtml}
        <!-- Total row -->
        <tr style="background:#f9fafb;">
          <td style="padding:10px 16px;font-size:13px;font-weight:700;color:#111827;
                      border-top:2px solid #e5e7eb;">Total</td>
          <td style="padding:10px 16px;font-size:14px;font-weight:700;color:#dc2626;
                      text-align:right;border-top:2px solid #e5e7eb;">${fmt(totalOutstanding)}</td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- CTA -->
  <tr>
    <td style="padding:0 0 20px 0;text-align:center;">
      <a href="${appUrl}/app/group-bills"
         style="display:inline-block;background:#2563eb;color:#ffffff;font-size:14px;
                font-weight:600;text-decoration:none;padding:13px 36px;border-radius:10px;">
        View Group Bills
      </a>
    </td>
  </tr>

  <!-- Footer note -->
  <tr>
    <td style="padding:0 0 0 0;">
      <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0;">
        This reminder was sent by ${senderName} via LifeFlow.<br/>
        Open LifeFlow to view full bill details and mark settlements as paid.
      </p>
    </td>
  </tr>

</table>`

  const html = wrapHtml(inner)

  // ── Plain text ─────────────────────────────────────────────────────────────
  const billLines = visibleBills
    .map((b) => `  • ${b.billName}: ${fmt(b.amountOwed)}`)
    .join('\n')

  const extraLine = extraCount > 0
    ? `  +${extraCount} more bill${extraCount !== 1 ? 's' : ''}\n`
    : ''

  const text =
    `LifeFlow Group Bill Reminder\n\n` +
    `Hi ${firstName},\n\n` +
    `${senderName} has sent you a Group Bill reminder.\n\n` +
    `You have ${fmt(totalOutstanding)} outstanding across ${bills.length} bill${bills.length !== 1 ? 's' : ''}:\n\n` +
    `${billLines}\n` +
    `${extraLine}\n` +
    `Total outstanding: ${fmt(totalOutstanding)}\n\n` +
    `Open LifeFlow to view and settle: ${appUrl}/app/group-bills\n\n` +
    `— The LifeFlow Team`

  return { subject, html, text }
}
