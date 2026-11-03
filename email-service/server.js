require("dotenv").config();

const cors = require("cors");
const express = require("express");
const nodemailer = require("nodemailer");

const app = express();
const port = Number(process.env.PORT || 3000);
const serviceToken = (process.env.EMAIL_SERVICE_TOKEN || "").trim();

if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
  throw new Error("GMAIL_USER and GMAIL_APP_PASSWORD must be configured");
}

if (!serviceToken) {
  throw new Error("EMAIL_SERVICE_TOKEN must be configured");
}

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER.trim(),
    pass: process.env.GMAIL_APP_PASSWORD.replace(/\s+/g, ""),
  },
});

app.use(cors());
app.use(express.json({ limit: "32kb" }));

function isValidEmail(value) {
  return typeof value === "string" &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/send-confirmation", async (req, res) => {
  const authHeader = req.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : authHeader.trim();
  if (token !== serviceToken) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { to, candidateName, jobTitle, confirmationUrl } = req.body ?? {};
  if (!isValidEmail(to) || typeof confirmationUrl !== "string" || !confirmationUrl.startsWith("http")) {
    return res.status(400).json({ error: "Valid recipient and confirmation URL are required" });
  }

  const safeName = typeof candidateName === "string" && candidateName.trim()
    ? candidateName.trim()
    : "there";
  const safeJobTitle = typeof jobTitle === "string" && jobTitle.trim()
    ? jobTitle.trim()
    : "your interview";

  try {
    await transporter.sendMail({
      from: `Resume Screening <${process.env.GMAIL_USER.trim()}>`,
      to,
      subject: `Interview confirmation for ${safeJobTitle}`,
      text: [
        `Hello ${safeName},`,
        "",
        `You have been shortlisted for ${safeJobTitle}.`,
        `Confirm your interview availability here: ${confirmationUrl}`,
        "",
        "This link expires in 72 hours.",
      ].join("\n"),
      html: `
        <p>Hello ${safeName},</p>
        <p>You have been shortlisted for <strong>${safeJobTitle}</strong>.</p>
        <p><a href="${confirmationUrl}">Confirm your interview availability</a></p>
        <p>This link expires in 72 hours.</p>
      `,
    });
    return res.json({ sent: true });
  } catch (error) {
    console.error("Email send failed:", error);
    return res.status(502).json({ error: "Email could not be sent" });
  }
});

app.listen(port, () => {
  console.log(`Email service listening on http://localhost:${port}`);
});
