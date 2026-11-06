const path = require("path");
const fs = require("fs");
const config = require("../config");

// Cache base64 of the Servi logo for inline email embedding
let cachedWhiteLogoB64 = null;
const getWhiteLogoB64 = () => {
  if (cachedWhiteLogoB64) return cachedWhiteLogoB64;
  try {
    const primaryPath = path.join(__dirname, "../assets/SERVI-LOGO-TRANSPARENT-WHITE.png");
    const fallbackPath = path.join(__dirname, "../../../servi_website/public/SERVI-LOGO-TRANSPARENT-WHITE.png");
    const targetPath = fs.existsSync(primaryPath) ? primaryPath : fs.existsSync(fallbackPath) ? fallbackPath : null;

    if (targetPath) {
      cachedWhiteLogoB64 = fs.readFileSync(targetPath).toString("base64");
      return cachedWhiteLogoB64;
    }
  } catch (err) {
    console.warn("Could not load logo for email:", err.message);
  }
  return null;
};

/**
 * Send an email using SMTP2GO HTTP API.
 * @param {Object} options
 * @param {string|string[]} options.to - Recipient email address(es)
 * @param {string} options.subject - Email subject
 * @param {string} options.htmlBody - HTML version of email content
 * @param {string} [options.textBody] - Plain text version of email content
 * @param {Array}  [options.inlines]  - Optional inline CID images [{ filename, fileblob, mimetype }]
 * @param {string} [options.sender]   - Optional override for sender email
 */
const sendEmail = async ({ to, subject, htmlBody, textBody, inlines, sender }) => {
  const apiKey = config.smtp2go?.apiKey || process.env.SMTP2GO_API_KEY || "api-94B34661B53549329753FA8B4A13B249";
  const senderEmail = sender || config.smtp2go?.sender || process.env.SMTP2GO_SENDER_EMAIL || "no-reply@servi.sa";

  if (!apiKey) {
    console.warn("[SMTP2GO MOCK] Email skipped - no API key configured. To:", to, "Subject:", subject);
    return { success: true, message: "MOCK: SMTP2GO not configured" };
  }

  const recipients = Array.isArray(to) ? to : [to];

  const payload = {
    api_key: apiKey,
    sender: senderEmail,
    to: recipients,
    subject: subject,
    html_body: htmlBody,
    text_body: textBody || htmlBody.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
  };

  if (Array.isArray(inlines) && inlines.length > 0) {
    payload.inlines = inlines;
  }

  try {
    const response = await fetch("https://api.smtp2go.com/v3/email/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (!response.ok || (data.data && data.data.failed > 0 && data.data.succeeded === 0)) {
      const errMsg = data.data?.failures?.[0] || data.data?.error || `HTTP ${response.status}`;
      throw new Error(`SMTP2GO Error: ${errMsg}`);
    }

    return { success: true, data: data.data };
  } catch (error) {
    console.error("❌ [EMAIL ERROR] Failed to send email via SMTP2GO:", error.message);
    throw error;
  }
};

/**
 * Sends a password reset email with a bulletproof button and embedded logo.
 * @param {Object} params
 * @param {string} params.to - Recipient email
 * @param {string} [params.name] - User name
 * @param {string} params.resetLink - Full URL with reset token
 * @param {boolean} [params.isRtl] - Whether to use Arabic formatting
 */
const sendPasswordResetEmail = async ({ to, name, resetLink, isRtl = false }) => {
  const greeting = name ? `Hello ${name},` : "Hello,";
  const subject = "Reset Your Servi Account Password | إعادة تعيين كلمة المرور";

  const logoB64 = getWhiteLogoB64();
  const inlines = logoB64
    ? [
        {
          filename: "servi-logo.png",
          fileblob: logoB64,
          mimetype: "image/png",
        },
      ]
    : [];

  const htmlBody = `
<!DOCTYPE html>
<html lang="en" dir="ltr" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Password</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; color: #0f172a;">
  <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation" style="background-color: #f1f5f9; table-layout: fixed;">
    <tr>
      <td align="center" style="padding: 40px 16px 60px 16px;">
        <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation" style="max-width: 580px; background-color: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 20px -2px rgba(0,0,0,0.06);">
          
          <!-- Header with solid dark slate background and white logo -->
          <tr>
            <td align="center" bgcolor="#0f172a" style="background-color: #0f172a; padding: 38px 24px 32px 24px; text-align: center;">
              <table border="0" cellpadding="0" cellspacing="0" role="presentation" align="center" style="margin: 0 auto;">
                <tr>
                  <td align="center">
                    <img src="cid:servi-logo.png" alt="SERVI" width="130" style="display: block; width: 130px; max-width: 130px; height: auto; border: 0; outline: none; text-decoration: none; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 24px; font-weight: 800; color: #ffffff; letter-spacing: 2px;" />
                  </td>
                </tr>
              </table>
              <h1 style="margin: 18px 0 0 0; color: #ffffff !important; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 21px; font-weight: 700; letter-spacing: -0.3px; line-height: 1.3;">
                Password Reset Request
              </h1>
              <p style="margin: 6px 0 0 0; color: #94a3b8; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 13px; font-weight: 400;">
                طلب إعادة تعيين كلمة المرور
              </p>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 36px 32px; background-color: #ffffff;">
              <p style="font-size: 17px; font-weight: 600; color: #0f172a; margin: 0 0 16px 0;">
                ${greeting}
              </p>
              <p style="font-size: 15px; line-height: 1.6; color: #334155; margin: 0 0 24px 0;">
                We received a request to reset the password for your account associated with <strong style="color: #0f172a;">${to}</strong>.
                Click the button below to choose a new password:
              </p>

              <!-- Bulletproof Button (100% visible on all email clients) -->
              <table border="0" cellpadding="0" cellspacing="0" role="presentation" align="center" style="margin: 32px auto 32px auto;">
                <tr>
                  <td align="center" bgcolor="#2563eb" style="border-radius: 8px; background-color: #2563eb;">
                    <!--[if mso]>
                    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${resetLink}" style="height:48px;v-text-anchor:middle;width:230px;" arcsize="18%" stroke="f" fillcolor="#2563eb">
                      <w:anchorlock/>
                      <center style="color:#ffffff;font-family:sans-serif;font-size:15px;font-weight:bold;">Reset Password</center>
                    </v:roundrect>
                    <![endif]-->
                    <!--[if !mso]><!-->
                    <a href="${resetLink}" target="_blank" style="display: inline-block; background-color: #2563eb; color: #ffffff !important; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 15px; font-weight: 700; text-decoration: none; padding: 14px 34px; border-radius: 8px; border: 1px solid #2563eb; text-align: center;">
                      Reset Password &nbsp;&rarr;
                    </a>
                    <!--<![endif]-->
                  </td>
                </tr>
              </table>

              <!-- Notice box -->
              <div style="border-left: 4px solid #f59e0b; background-color: #fefce8; padding: 12px 16px; border-radius: 0 8px 8px 0; font-size: 13px; color: #854d0e; margin: 24px 0; line-height: 1.5;">
                ⏰ <strong>Important:</strong> This password reset link will expire in <strong>1 hour</strong>. For security, it can only be used once.
              </div>

              <!-- Fallback Link box -->
              <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 16px; margin: 24px 0; word-break: break-all; font-size: 12px; color: #64748b; line-height: 1.5;">
                <span style="font-weight: 600; color: #334155;">Button not clickable?</span> Copy and paste this URL into your browser:<br>
                <a href="${resetLink}" target="_blank" style="color: #2563eb; text-decoration: underline; font-weight: 500;">${resetLink}</a>
              </div>

              <p style="font-size: 13px; line-height: 1.5; color: #64748b; margin: 24px 0 0 0;">
                If you did not request this password reset, please ignore this email or contact support. Your password will remain unchanged.
              </p>

              <!-- Arabic Section -->
              <div style="direction: rtl; text-align: right; border-top: 1px solid #e2e8f0; padding-top: 24px; margin-top: 28px;">
                <p style="font-size: 16px; font-weight: 600; color: #0f172a; margin: 0 0 12px 0;">
                  مرحباً ${name ? name : ""}،
                </p>
                <p style="font-size: 14px; line-height: 1.7; color: #334155; margin: 0;">
                  لقد تلقينا طلباً لإعادة تعيين كلمة المرور لحسابك في منصة <strong>سيرفي</strong>. يمكنك تعيين كلمة مرور جديدة بالنقر على الزر أعلاه أو استخدام الرابط المباشر.
                  <br>
                  تنتهي صلاحية هذا الرابط خلال <strong>ساعة واحدة</strong>. إذا لم تطلب هذا الإجراء، يمكنك تجاهل هذه الرسالة ولن يتم تغيير كلمة المرور الخاصة بك.
                </p>
              </div>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" bgcolor="#f8fafc" style="background-color: #f8fafc; padding: 22px 32px; border-top: 1px solid #e2e8f0; text-align: center; font-size: 12px; color: #94a3b8; line-height: 1.5;">
              &copy; ${new Date().getFullYear()} Servi (سيرفي) Inc. All rights reserved.<br>
              This is an automated system security notification, please do not reply.
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  const textBody = `
Reset Your Servi Account Password

${greeting}

We received a request to reset your password. Use the link below to set a new password:
${resetLink}

This link is valid for 1 hour. If you did not request this change, you can safely ignore this email.

---
© ${new Date().getFullYear()} Servi Inc.
  `.trim();

  return sendEmail({
    to,
    subject,
    htmlBody,
    textBody,
    inlines,
  });
};

/**
 * Sends a one-time verification code (OTP) for dashboard login.
 * @param {Object} params
 * @param {string} params.to - Recipient email
 * @param {string} [params.name] - User name
 * @param {string} params.code - 6-digit OTP code
 * @param {boolean} [params.isRtl] - Whether to use Arabic formatting
 */
const sendLoginOtpEmail = async ({ to, name, code, isRtl = false }) => {
  const greeting = name ? `Hello ${name},` : "Hello,";
  const subject = `${code} is your Servi login verification code | رمز التحقق لتسجيل الدخول`;

  const logoB64 = getWhiteLogoB64();
  const inlines = logoB64
    ? [
        {
          filename: "servi-logo.png",
          fileblob: logoB64,
          mimetype: "image/png",
        },
      ]
    : [];

  const htmlBody = `
<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login Verification Code</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; color: #0f172a;">
  <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation" style="background-color: #f1f5f9; table-layout: fixed;">
    <tr>
      <td align="center" style="padding: 40px 16px 60px 16px;">
        <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation" style="max-width: 540px; background-color: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 20px -2px rgba(0,0,0,0.06);">
          
          <!-- Header with solid dark slate background and white logo -->
          <tr>
            <td align="center" bgcolor="#0f172a" style="background-color: #0f172a; padding: 36px 24px 30px 24px; text-align: center;">
              <table border="0" cellpadding="0" cellspacing="0" role="presentation" align="center" style="margin: 0 auto;">
                <tr>
                  <td align="center">
                    <img src="cid:servi-logo.png" alt="SERVI" width="130" style="display: block; width: 130px; max-width: 130px; height: auto; border: 0; outline: none; text-decoration: none; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 24px; font-weight: 800; color: #ffffff; letter-spacing: 2px;" />
                  </td>
                </tr>
              </table>
              <h1 style="margin: 18px 0 0 0; color: #ffffff !important; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 20px; font-weight: 700; letter-spacing: -0.3px; line-height: 1.3;">
                Login Verification Code
              </h1>
              <p style="margin: 6px 0 0 0; color: #94a3b8; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 13px; font-weight: 400;">
                رمز التحقق لتسجيل الدخول
              </p>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 34px 30px; background-color: #ffffff;">
              <p style="font-size: 16px; font-weight: 600; color: #0f172a; margin: 0 0 14px 0;">
                ${greeting}
              </p>
              <p style="font-size: 15px; line-height: 1.6; color: #334155; margin: 0 0 20px 0;">
                Use the following 6-digit one-time code to complete your sign-in to the Servi platform:
              </p>

              <!-- OTP Code Box -->
              <table border="0" cellpadding="0" cellspacing="0" role="presentation" align="center" style="margin: 28px auto 28px auto; width: 100%; max-width: 380px;">
                <tr>
                  <td align="center" bgcolor="#f8fafc" style="background-color: #f8fafc; border: 2px dashed #93c5fd; border-radius: 12px; padding: 20px 16px; text-align: center;">
                    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: #2563eb; margin-bottom: 6px;">
                      Verification Code
                    </div>
                    <div style="font-family: 'Courier New', Courier, monospace; font-size: 38px; font-weight: 800; letter-spacing: 10px; color: #1e1b4b; line-height: 1; padding: 6px 0 6px 10px;">
                      ${code}
                    </div>
                    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 12px; color: #64748b; margin-top: 6px;">
                      Valid for 10 minutes &bull; صالح لمدة 10 دقائق
                    </div>
                  </td>
                </tr>
              </table>

              <!-- Notice Box -->
              <div style="border-left: 4px solid #f59e0b; background-color: #fefce8; padding: 12px 16px; border-radius: 0 8px 8px 0; font-size: 13px; color: #854d0e; margin: 22px 0; line-height: 1.5;">
                ⏰ <strong>Security Notice:</strong> Never share this code with anyone. Servi support staff will never ask for your verification code.
              </div>

              <p style="font-size: 13px; line-height: 1.5; color: #64748b; margin: 20px 0 0 0;">
                If you did not attempt to sign in, please ignore this email or contact your platform administrator immediately.
              </p>

              <!-- Arabic Section -->
              <div style="direction: rtl; text-align: right; border-top: 1px solid #e2e8f0; padding-top: 22px; margin-top: 26px;">
                <p style="font-size: 15px; font-weight: 600; color: #0f172a; margin: 0 0 10px 0;">
                  مرحباً ${name ? name : ""}،
                </p>
                <p style="font-size: 13px; line-height: 1.7; color: #334155; margin: 0;">
                  رمز التحقق الخاص بك لتسجيل الدخول إلى منصة <strong>سيرفي</strong> هو: <strong style="font-size: 16px; color: #2563eb; letter-spacing: 3px;">${code}</strong>
                  <br>
                  صلاحية هذا الرمز تنتهي خلال <strong>10 دقائق</strong>. لا تشارك هذا الرمز مع أي شخص حفاظاً على أمان حسابك.
                </p>
              </div>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" bgcolor="#f8fafc" style="background-color: #f8fafc; padding: 20px 24px; border-top: 1px solid #e2e8f0; text-align: center; font-size: 12px; color: #94a3b8; line-height: 1.5;">
              &copy; ${new Date().getFullYear()} Servi Inc. All rights reserved.<br>
              This is an automated security message, please do not reply.
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  const textBody = `
Servi Login Verification Code: ${code}

${greeting}

Your 6-digit verification code to sign in is: ${code}

This code will expire in 10 minutes. If you did not request this login, please ignore this message.

---
© ${new Date().getFullYear()} Servi Inc.
  `.trim();

  return sendEmail({
    to,
    subject,
    htmlBody,
    textBody,
    inlines,
  });
};

module.exports = {
  sendEmail,
  sendPasswordResetEmail,
  sendLoginOtpEmail,
};
