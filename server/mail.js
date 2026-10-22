import nodemailer from "nodemailer";
import { config } from "./config.js";

const { smtp } = config;

/* Port 465 is implicit TLS; anything else (587) must upgrade with STARTTLS.
   requireTLS makes a missing or stripped STARTTLS offer a hard failure instead
   of silently sending the login and reset links in plaintext. Only a relay on
   this machine is exempt. The timeouts keep a dead mail server from holding a
   request open. */
const secure = smtp.port === 465;
const loopback = ["localhost", "127.0.0.1", "::1"].includes(smtp.host);
const transport = smtp.host
  ? nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure,
      requireTLS: !secure && !loopback,
      auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 15000
    })
  : null;

export const mailEnabled = Boolean(transport);

/* Resolves true when the server accepted the message, false on any failure or
   when mail is off, so callers fall back to showing the link to an admin. */
export async function sendMail({ to, subject, text, attachments }) {
  if (!transport) return false;
  try {
    await transport.sendMail({ from: smtp.from, to, subject, text, attachments });
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
