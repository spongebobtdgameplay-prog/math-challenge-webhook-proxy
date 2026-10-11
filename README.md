# Math Challenge Webhook Proxy

A small Node.js service that forwards a constrained usage notice to Discord. The Discord webhook URL stays in the server's `DISCORD_URL` environment variable.

## Render settings

- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`
- Environment variables:
  - `DISCORD_URL`: the Discord webhook URL
  - `PROXY_API_KEY`: a random string at least 24 characters long

The GitHub repository can be named `Math Challenge Webhook Proxy` (GitHub's canonical repository slug will normally be lowercase with hyphens). The Render service can independently be named `Math Challenge Server Main`.

## Endpoints

- `GET /` — basic service status
- `GET /health` — JSON health check
- `POST /notify` — sends a constrained usage notice to Discord

`POST /notify` requires `Authorization: Bearer <PROXY_API_KEY>` and accepts only this JSON shape:

```json
{
  "build": "1.4.9",
  "bearerId": "0123456789abcdef"
}
```

`bearerId` must be a 16-character hexadecimal SHA-256 prefix, or `unavailable`. It is a one-way fingerprint, not the bearer token itself. The server creates the Discord message itself and does not accept arbitrary Discord content or URLs. The endpoint explicitly rejects raw token fields such as `bearerToken` or `accessToken`; do not send live Teams session credentials to this proxy.

## Important client-side limitation

If the extension contains `PROXY_API_KEY`, someone who can inspect the extension can extract that key. It is useful as a basic gate, not a secret that can be kept from extension users. The server also applies a simple in-memory per-IP rate limit.

Never put the real webhook URL in this repository. Configure it only in Render's Environment settings. If a real webhook URL was previously exposed in an extension or chat, regenerate it in Discord before using it here.
