// .light — branded email templates.
import config from './../config.js';

const brand = () => ({
  product: config.brand.product,
  domain: config.platformDomain,
  attribution: config.brand.attribution,
  primary: config.brand.primaryColor,
});

function layout(title, bodyHtml) {
  const b = brand();
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;background:#080A09;color:#EDE7DE;font-family:Manrope,Arial,sans-serif">
    <div style="max-width:560px;margin:0 auto;padding:40px 24px">
      <div style="font-size:22px;font-weight:800;letter-spacing:-.02em;color:${b.primary}">${b.product}</div>
      <div style="background:#1C201C;border:1px solid rgba(237,231,222,.08);border-radius:14px;padding:28px;margin-top:24px">
        ${bodyHtml}
      </div>
      <div style="color:#5F594F;font-size:11px;margin-top:20px;text-align:center">${b.attribution}<br>${b.domain}</div>
    </div>
  </body></html>`;
}

export function verificationEmail(link, product) {
  return {
    subject: `Verify your ${product} account`,
    html: layout('Verify your account', `<h1 style="margin:0 0 12px;font-size:22px">Verify your email</h1>
      <p style="color:#B8B0A4;font-size:14px;line-height:1.6">Welcome to ${product}. Please verify your email address to complete your account setup.</p>
      <a href="${link}" style="display:inline-block;background:${config.brand.primaryColor};color:#FFF7F4;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:700;margin-top:10px">Verify email</a>
      <p style="color:#5F594F;font-size:12px;margin-top:18px">If you did not create this account, you can ignore this email.</p>`),
    text: `Welcome to ${product}. Verify your email: ${link}`,
  };
}

export function passwordResetEmail(link, product) {
  return {
    subject: `Reset your ${product} password`,
    html: layout('Reset password', `<h1 style="margin:0 0 12px;font-size:22px">Reset your password</h1>
      <p style="color:#B8B0A4;font-size:14px;line-height:1.6">We received a request to reset your ${product} password. This link expires in 30 minutes.</p>
      <a href="${link}" style="display:inline-block;background:${config.brand.primaryColor};color:#FFF7F4;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:700;margin-top:10px">Reset password</a>
      <p style="color:#5F594F;font-size:12px;margin-top:18px">If you did not request this, ignore this email and your password will remain unchanged.</p>`),
    text: `Reset your ${product} password: ${link}`,
  };
}

export function welcomeEmail(product) {
  return {
    subject: `Welcome to ${product}`,
    html: layout('Welcome', `<h1 style="margin:0 0 12px;font-size:22px">Welcome to ${product}</h1>
      <p style="color:#B8B0A4;font-size:14px;line-height:1.6">Your account is ready. Create your first server from the dashboard to get started.</p>`),
    text: `Welcome to ${product}. Your account is ready.`,
  };
}
