/**
 * lib/auth/email-templates.ts — HTML + plain-text email templates.
 *
 * All templates are self-contained inline-style HTML so they render correctly
 * in all major email clients without an external CSS file.
 *
 * SERVER-ONLY — never import from client components.
 */

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
