"use strict";

const crypto = require("node:crypto");
const express = require("express");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const DISCORD_URL = process.env.DISCORD_URL;
const PROXY_API_KEY = process.env.PROXY_API_KEY;

app.disable("x-powered-by");
// Render runs behind a proxy. This lets Express use the client IP supplied by Render.
app.set("trust proxy", 1);
app.use(express.json({ limit: "2kb", strict: true }));

function validateDiscordUrl(value) {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    const allowedHost = parsed.hostname === "discord.com" || parsed.hostname === "discordapp.com";
    return parsed.protocol === "https:" && allowedHost && /^\/api\/webhooks\/[0-9]+\//.test(parsed.pathname);
  } catch {
    return false;
  }
}

if (!validateDiscordUrl(DISCORD_URL)) {
  throw new Error("DISCORD_URL is missing or is not a valid Discord webhook URL.");
}
if (!PROXY_API_KEY || PROXY_API_KEY.length < 24) {
  throw new Error("PROXY_API_KEY is required and must be at least 24 characters long.");
}

// Basic in-memory rate limit: maximum 10 notifications per client IP per minute.
// This resets when the service restarts and is not a substitute for durable rate limiting.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 10;
const ipWindows = new Map();

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of ipWindows) {
    if (now - entry.windowStart >= RATE_WINDOW_MS * 2) ipWindows.delete(ip);
  }
}, RATE_WINDOW_MS);
cleanupTimer.unref();

function rateLimit(req, res, next) {
  const ip = String(req.ip || req.socket.remoteAddress || "unknown");
  const now = Date.now();
  let entry = ipWindows.get(ip);

  if (!entry || now - entry.windowStart >= RATE_WINDOW_MS) {
    entry = { windowStart: now, count: 0 };
    ipWindows.set(ip, entry);
  }

  entry.count += 1;
  if (entry.count > RATE_MAX) {
    return res.status(429).json({ error: "Too many requests. Try again in a minute." });
  }
  return next();
}

function hasValidApiKey(req) {
  const header = req.get("authorization") || "";
  const match = /^Bearer (.+)$/.exec(header);
  if (!match) return false;

  const supplied = Buffer.from(match[1], "utf8");
  const expected = Buffer.from(PROXY_API_KEY, "utf8");
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

app.get("/", (_req, res) => {
  res.type("text/plain").send("Math Challenge Webhook Proxy is running.");
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/notify", rateLimit, async (req, res) => {
  if (!hasValidApiKey(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // A Teams bearer token is a live session credential. This public-facing proxy must
  // never receive, store, log, or forward it. Accept only its non-reversible fingerprint.
  const rawTokenFields = ["bearerToken", "bearer_token", "accessToken", "access_token", "token"];
  if (req.body && typeof req.body === "object" &&
      rawTokenFields.some((field) => Object.prototype.hasOwnProperty.call(req.body, field))) {
    return res.status(400).json({
      error: "Raw bearer tokens are not accepted. Send only the SHA-256 bearerId fingerprint."
    });
  }

  // Only accept a build label and a short SHA-256 fingerprint. Never accept or forward
  // a bearer token, Teams conversation ID, message body, arbitrary Discord content, or URL.
  const build = typeof req.body?.build === "string" ? req.body.build : "unknown";
  const bearerId = typeof req.body?.bearerId === "string" ? req.body.bearerId : "unavailable";

  if (!/^[a-zA-Z0-9._-]{1,32}$/.test(build)) {
    return res.status(400).json({ error: "Invalid build value" });
  }
  if (bearerId !== "unavailable" && !/^[a-fA-F0-9]{16}$/.test(bearerId)) {
    return res.status(400).json({ error: "Invalid bearerId value" });
  }

  const message = [
    "🧮 Math Challenge Sender usage alert",
    "A user successfully sent a math challenge to Teams.",
    `Build: ${build}`,
    `Time (UTC): ${new Date().toISOString()}`,
    `Bearer Id (SHA-256 prefix): ${bearerId}`,
    "Privacy: no bearer token, Teams identity, conversation ID, message content, or cookies were included."
  ].join("\n");

  try {
    const discordResponse = await fetch(DISCORD_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: message,
        allowed_mentions: { parse: [] }
      }),
      signal: AbortSignal.timeout(10_000)
    });

    if (!discordResponse.ok) {
      // Do not log or return Discord's URL or raw response, since these can reveal details.
      console.error(`Discord notification returned HTTP ${discordResponse.status}.`);
      return res.status(502).json({ error: "Discord notification failed" });
    }

    return res.status(202).json({ ok: true, notified: true });
  } catch {
    console.error("Discord notification request failed.");
    return res.status(502).json({ error: "Discord notification failed" });
  }
});

app.use((_req, res) => {
  res.status(404).json({ error: "API route not found" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Math Challenge Webhook Proxy listening on port ${PORT}`);
});
