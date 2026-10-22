import nodemailer from "nodemailer";
import { config } from "./config.js";

const { smtp } = config;

/* Port 465 is implicit TLS; anything else (587) upgrades with STARTTLS. The
   timeouts keep a dead mail server from holding a request open. */
const transport = smtp.host
  ? nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.port === 465,
      auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 15000
    })
  : null;

export const mailEnabled = Boolean(transport);

/* Resolves true when the server accepted the message, false on any failure or
   when mail is off, so callers fall back to showing the link to an admin. */
export async function sendMail({ to, subject, text }) {
  if (!transport) return false;
  try {
    await transport.sendMail({ from: smtp.from, to, subject, text });
    return true;
  } catch (err) {
    console.error("mail failed:", err.code || err.message);
    return false;
  }
}

export const sendInviteEmail = (to, link, hoursValid) =>
  sendMail({
    to,
    subject: "Your CX Quiz host link",
    text:
      `Hello,\n\nUse this link to set your CX Quiz host password:\n\n${link}\n\n` +
      `It works once and expires in ${hoursValid} hours. If you did not ask for it, ignore this email.\n`
  });
