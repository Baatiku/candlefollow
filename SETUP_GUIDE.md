# Besta Bot — Setup Guide

## Option A: Windows Desktop (.exe)

1. Download `BestaBot.exe` from [bestabot.com](https://bestabot.com)
2. Run the application
3. Enter your IQ Option email and password
4. Enter your license key (`BESTA-FREE-TRIAL` for 72-hour free trial)
5. Choose Practice or Real account
6. Click **START BOT**

No installation required. The bot runs locally on your machine.

---

## Option B: 24/7 Cloud (Railway)

1. Click the **Deploy to Railway** button on [bestabot.com](https://bestabot.com)
2. Sign in to Railway (free account)
3. Set these environment variables when prompted:
   - `IQ_EMAIL` — your IQ Option email
   - `IQ_PASSWORD` — your IQ Option password
   - `IQ_ACCOUNT_TYPE` — `PRACTICE` or `REAL`
   - `LICENSE_KEY` — your license key
4. Click **Deploy**
5. Open the Railway-provided URL — the dashboard will appear

The bot runs 24/7 in the cloud. You do not need to keep your laptop open.

---

## Option C: Docker (Mac / Linux / Windows with Docker Desktop)

### Prerequisites
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed

### Steps

```bash
# 1. Clone the repository
git clone https://github.com/wixsta/iqoption
cd iqoption

# 2. Create your .env file
cp .env.example .env

# 3. Edit .env — fill in your credentials
nano .env

# 4. Start the bot
docker-compose up -d

# 5. Open the dashboard
open http://localhost:5000
```

### Stop the bot
```bash
docker-compose down
```

### View logs
```bash
docker-compose logs -f
```

---

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `IQ_EMAIL` | Yes | — | Your IQ Option account email |
| `IQ_PASSWORD` | Yes | — | Your IQ Option account password |
| `IQ_ACCOUNT_TYPE` | — | `PRACTICE` | `PRACTICE` or `REAL` |
| `TRADING_MODE` | — | `turbo` | `turbo` or `digital` |
| `LICENSE_KEY` | — | — | Your Besta Bot license key |
| `BOT_API_KEY` | — | _(disabled)_ | Random string to protect write endpoints |
| `ALLOWED_ORIGINS` | — | `*` | Comma-separated allowed CORS origins |
| `AUTO_START` | — | `true` | Auto-start trading on boot |

---

## Troubleshooting

**Dashboard shows "Not Connected"**
- Check that `IQ_EMAIL` and `IQ_PASSWORD` are set correctly
- Click **Reconnect** on the dashboard
- Check server logs for connection errors

**"License invalid" error**
- Ensure the key is entered exactly as provided (no spaces)
- Trial codes are one-per-machine — contact support if already used
- WhatsApp support: [wa.me/2347010102053](https://wa.me/2347010102053)

**Docker port conflict**
- Change the mapping in `docker-compose.yml` to `"5001:5000"` then open `http://localhost:5001`
