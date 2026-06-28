# Besta Bot — Model A Product Plan
## Self-Hosted Per-User Deployment

> This document is the complete implementation roadmap for turning Besta Bot into a
> distributable product where each user runs their own private bot instance.
> Read PROGRESS_LOG.md first to understand what has already been built.

---

## What Already Exists (Do Not Rebuild)

| Component | Status | Location |
|-----------|--------|----------|
| Landing page | ✅ Built | `website/index.html` + `website/style.css` |
| Windows .exe | ✅ Built (needs re-packaging after changes) | `website/BestaBot.exe` |
| License manager | ✅ Built | `src/licensing.py` |
| Supabase token schema | ✅ Built | `supabase/migrations/` |
| Desktop GUI | ✅ Built | `src/gui.py` + `src/main.py` |
| Railway deployment | ✅ Working (single user) | `railway.toml` |
| Web dashboard | ✅ Built | `frontend/src/App.jsx` |

---

## Model A Overview

Every user gets their own **isolated** bot instance. Two deployment paths:

```
Path 1 (Windows Desktop):
  User buys token → downloads .exe → enters IQ credentials + token → bot runs on their PC

Path 2 (Cloud / Railway):
  User buys token → clicks "Deploy to Railway" → sets 3 env vars → bot runs 24/7 in cloud
```

Both paths use the same backend code. The difference is only where it runs.
The token system (Supabase + HWID) is already built and enforces one-token-per-machine.

---

## Phase 1 — In-App Onboarding Screen
**Priority: HIGH — blocks all user-facing deployment**
**Estimated effort: 2–3 days**

### Problem
When a new user deploys the app without setting `IQ_EMAIL`, they see the trading dashboard
with a "Not Connected" state and no guidance on what to do. This is confusing.

### What to Build

#### 1.1 — Backend: Setup detection + `/api/setup` endpoint

**File: `src/api.py`**

Add a new endpoint that detects whether the bot is unconfigured:

```python
@app.get("/api/setup-status")
def get_setup_status():
    """Returns whether initial configuration is complete."""
    return {
        "needs_setup": not bool(os.environ.get("IQ_EMAIL")),
        "has_license": bool(os.environ.get("SUPABASE_URL")),
        "account_type": os.environ.get("IQ_ACCOUNT_TYPE", "PRACTICE"),
        "version": _get_version(),
    }

@app.post("/api/setup")
async def complete_setup(body: SetupRequest):
    """
    Validates credentials by attempting a test connection.
    Writes env vars to a local .env file (for Docker/laptop deployments).
    Returns error if IQ Option login fails or license is invalid.
    
    NOTE: On Railway, env vars are set in the Railway dashboard — this endpoint
    tells the user to do that if we detect a Railway environment.
    """
    ...
```

Add `SetupRequest` Pydantic model:
```python
class SetupRequest(BaseModel):
    iq_email: str
    iq_password: str
    iq_account_type: str = "PRACTICE"
    license_key: str = ""
```

**Logic flow for `/api/setup` POST:**
1. Detect environment: Railway (check `RAILWAY_ENVIRONMENT` env var) vs local
2. If Railway: return `{"mode": "railway", "message": "Set IQ_EMAIL in Railway dashboard"}`
3. If local: attempt IQ Option login with provided credentials
4. If login OK: write `.env` file, return success
5. If login fails: return 401 with IQ error message
6. If license key provided: validate against Supabase before accepting

#### 1.2 — Frontend: Onboarding flow

**File: `frontend/src/App.jsx`**

At the top of the App component, before rendering the main dashboard, add:

```jsx
const [setupStatus, setSetupStatus] = useState(null);

useEffect(() => {
  apiFetch('/setup-status').then(r => r.json()).then(setSetupStatus);
}, []);

if (!setupStatus) return <LoadingScreen />;
if (setupStatus.needs_setup) return <SetupWizard onComplete={() => window.location.reload()} />;
```

**`<SetupWizard>` component — 3 steps:**

**Step 1: License Key**
- Input for license key
- Button: "Verify License"
- Shows checkmark + expiry date on success
- `BESTA-FREE-TRIAL` activates 72-hour trial automatically
- If no Supabase configured (personal deployment with no license system): skip this step

**Step 2: IQ Option Credentials**
- Input: Email
- Input: Password (masked)
- Dropdown: Practice / Real
- Button: "Test Connection"
- Shows spinner while testing, then ✅ or ❌ with error message

**Step 3: Confirm & Launch**
- Summary of what was entered
- "Start Bot" button
- Redirects to main dashboard on success

**On Railway:** Step 2 shows: "You are running on Railway. Set IQ_EMAIL and IQ_PASSWORD
in your Railway project's Variables tab, then redeploy." with a screenshot guide.

#### 1.3 — License gate in web dashboard

**File: `src/api.py`**

On startup, if `SUPABASE_URL` is configured and `LICENSE_KEY` env var is set:
- Validate the license key against Supabase
- If invalid/expired: bot refuses to start trading (but dashboard loads normally)
- Status response includes `{"license_valid": bool, "license_message": str}`

**File: `frontend/src/App.jsx`**

If `status.license_valid === false`, show a full-width banner:
```
⚠️ License expired or invalid. Bot will not trade.
[Renew License] button → opens WhatsApp link
```

---

## Phase 2 — Docker / Laptop Deployment
**Priority: HIGH — enables non-Windows users to run locally**
**Estimated effort: 1–2 days**

### 2.1 — `Dockerfile`

**File: `Dockerfile`** (create at project root)

```dockerfile
FROM python:3.12-slim

# System dependencies
RUN apt-get update && apt-get install -y \
    nodejs npm curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Build frontend
COPY frontend/ frontend/
RUN cd frontend && npm install && npm run build

# Copy source
COPY src/ src/
COPY data/ data/

# Create data directory
RUN mkdir -p data

EXPOSE 5000

CMD ["uvicorn", "src.api:app", "--host", "0.0.0.0", "--port", "5000"]
```

### 2.2 — `docker-compose.yml`

**File: `docker-compose.yml`** (create at project root)

```yaml
version: '3.8'

services:
  bestabot:
    build: .
    ports:
      - "5000:5000"
    volumes:
      - ./data:/app/data       # Persist state and trade logs
    env_file:
      - .env
    restart: unless-stopped

# Usage:
#   1. Copy .env.example to .env and fill in your credentials
#   2. docker-compose up -d
#   3. Open http://localhost:5000
```

### 2.3 — `.env.example`

**File: `.env.example`** (create at project root)

```env
# IQ Option credentials (required)
IQ_EMAIL=your_email@example.com
IQ_PASSWORD=your_password

# Account type: PRACTICE or REAL
IQ_ACCOUNT_TYPE=PRACTICE

# License key (required if using cloud licensing)
LICENSE_KEY=BESTA-FREE-TRIAL

# Bot API security (recommended — set any random string)
BOT_API_KEY=

# Optional: restrict dashboard access to your domain only
ALLOWED_ORIGINS=*

# Optional: Supabase (needed for license validation)
SUPABASE_URL=
SUPABASE_KEY=
```

### 2.4 — `SETUP_GUIDE.md`

**File: `SETUP_GUIDE.md`** (create at project root)

Detailed guide covering:
- **Windows users:** Download `.exe`, run, enter token → done
- **Docker users:** `git clone` → copy `.env.example` → fill `.env` → `docker-compose up -d`
- **Railway users:** Click Deploy button → set env vars in Railway dashboard → done
- **Advanced:** Custom domain, SSL, auto-restart on crash

---

## Phase 3 — Railway One-Click Deploy Template
**Priority: MEDIUM — enables cloud deployment for non-technical users**
**Estimated effort: 1 day**

### 3.1 — `railway.json`

**File: `railway.json`** (create at project root)

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "startCommand": "cd src && uvicorn api:app --host 0.0.0.0 --port $PORT",
    "healthcheckPath": "/api/health",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

### 3.2 — Landing page: "Deploy to Railway" button

**File: `website/index.html`**

Add a third CTA button in the hero section:
```html
<a href="https://railway.app/template/XXXXXXX" class="btn-secondary" target="_blank">
  <svg><!-- Cloud icon --></svg>
  Deploy to Railway (24/7 Cloud)
</a>
```

The Railway template URL is generated when you publish the template in the Railway dashboard.
It will auto-populate the env var prompts for the user.

### 3.3 — Update `railway.toml` with env var prompts

**File: `railway.toml`** (update existing)

Add the template section so Railway prompts the user for required env vars:
```toml
[template]
name = "Besta Bot"
description = "Automated IQ Option trading bot with Double Martingale strategy"
tags = ["trading", "bot", "automation"]

[[template.variables]]
name = "IQ_EMAIL"
description = "Your IQ Option account email"
required = true
secret = true

[[template.variables]]
name = "IQ_PASSWORD"
description = "Your IQ Option account password"
required = true
secret = true

[[template.variables]]
name = "IQ_ACCOUNT_TYPE"
description = "PRACTICE or REAL"
default = "PRACTICE"

[[template.variables]]
name = "LICENSE_KEY"
description = "Your Besta Bot license key (use BESTA-FREE-TRIAL for 72h trial)"
required = false

[[template.variables]]
name = "BOT_API_KEY"
description = "A random secret to protect your bot dashboard (recommended)"
required = false
```

---

## Phase 4 — Windows .exe Repackaging
**Priority: MEDIUM — keeps desktop users on latest version**
**Estimated effort: 2–3 days**

### Current state
The `website/BestaBot.exe` was built from the existing `gui.py` + `main.py`.
Since many changes have been made to the bot strategy logic, it needs rebuilding.

### 4.1 — PyInstaller spec file

**File: `build/bestabot.spec`** (create)

```python
# -*- mode: python ; coding: utf-8 -*-

block_cipher = None

a = Analysis(
    ['src/main.py'],
    pathex=['src'],
    binaries=[],
    datas=[
        ('src/data', 'data'),           # Include default data dir
        ('website/index.html', 'website'),  # Not needed for exe
    ],
    hiddenimports=[
        'iqoptionapi',
        'websocket',
        'customtkinter',
        'supabase',
        'getmac',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='BestaBot',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,        # No console window — GUI only
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon='build/bestabot.ico',  # Add icon file
)
```

**Build command (run on Windows):**
```
pip install pyinstaller
pyinstaller build/bestabot.spec --clean
```

### 4.2 — Auto-update check in `gui.py`

Add to `BotApp.__init__()`:
```python
def _check_for_updates(self):
    """Checks a hosted version.json for a newer release."""
    try:
        import urllib.request, json
        url = "https://bestabot.com/version.json"  # or GitHub raw
        with urllib.request.urlopen(url, timeout=3) as r:
            data = json.loads(r.read())
        latest = data.get("version")
        current = "1.0.0"  # Read from embedded version.txt
        if latest and latest != current:
            self._show_update_banner(latest, data.get("download_url"))
    except Exception:
        pass  # Silent fail — never interrupt startup
```

**File: `website/version.json`** (host on landing page server):
```json
{
  "version": "1.1.0",
  "release_date": "2026-06-15",
  "download_url": "https://bestabot.com/BestaBot.exe",
  "changelog": "Fixed debt display bugs and added security improvements"
}
```

### 4.3 — Crash reporter

Add to `main.py`:
```python
import sys

def handle_exception(exc_type, exc_value, exc_traceback):
    """Send anonymised crash info to monitoring (no credentials sent)."""
    if issubclass(exc_type, KeyboardInterrupt):
        sys.__excepthook__(exc_type, exc_value, exc_traceback)
        return
    logger.error("Uncaught exception", exc_info=(exc_type, exc_value, exc_traceback))
    # Optional: POST to a crash logging URL (no personal data)

sys.excepthook = handle_exception
```

---

## Phase 5 — License System Integration in Web Dashboard
**Priority: LOW (already works in desktop) — needed for cloud deployment**
**Estimated effort: 1–2 days**

### 5.1 — License validation on bot startup

**File: `src/api.py` — `startup_event()`**

After connecting to IQ Option, if `LICENSE_KEY` env var is set:
```python
license_key = os.environ.get("LICENSE_KEY", "")
if license_key and bot.license_manager:
    valid, msg = bot.license_manager.validate_and_activate(license_key)
    if not valid:
        bot.license_valid = False
        bot.license_message = msg
        logger.error(f"License invalid: {msg} — bot will not trade")
    else:
        bot.license_valid = True
        bot.license_message = msg
```

**File: `src/strategies/double_martingale.py`**

In `run()`, at the top of the trading loop:
```python
if not getattr(self, 'license_valid', True):
    logger.error("No valid license — stopping.")
    self.last_stop_reason = self.license_message or "License required"
    return
```

### 5.2 — License status in `/api/status`

Add to `get_state()` response:
```python
"license_valid": getattr(self, 'license_valid', True),
"license_message": getattr(self, 'license_message', ''),
"license_expires": getattr(self, 'license_expires', ''),
```

---

## Phase 6 — Distribution & Marketing Site Updates
**Priority: LOW — do after all features are working**
**Estimated effort: 1 day**

### 6.1 — Landing page updates needed

The existing `website/index.html` needs these additions:

1. **"Deploy to Railway" button** in the hero section (see Phase 3.2)
2. **How It Works** section explaining the two paths (download vs cloud)
3. **Screenshot** of the dashboard (take from browser after deployment)
4. **FAQ section:**
   - "Do you see my trades?" → No, bot runs on your machine
   - "What if I close my laptop?" → Use Railway for 24/7 cloud version
   - "Can I use a REAL account?" → Yes, switch in the dashboard
   - "What happens when my license expires?" → Bot stops trading, you renew via WhatsApp
5. **Support section:** WhatsApp link prominently displayed

### 6.2 — GitHub README

**File: `README.md`** (create at project root — public-facing)

```markdown
# Besta Bot
> Automated IQ Option trading bot with Double Martingale strategy

## Quick Start

### Option A: Windows Desktop
1. [Download BestaBot.exe](https://bestabot.com)
2. Run the application
3. Enter your license key (use `BESTA-FREE-TRIAL` for 72h free)
4. Enter your IQ Option credentials
5. Click Start

### Option B: 24/7 Cloud (Railway)
[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/XXXXXXX)

### Option C: Self-hosted (Docker)
\`\`\`bash
git clone https://github.com/wixsta/iqoption
cp .env.example .env
# Edit .env with your credentials
docker-compose up -d
open http://localhost:5000
\`\`\`

## License
Purchase a license at [bestabot.com](https://bestabot.com) or contact
[WhatsApp](https://wa.me/2347010102053).
```

---

## Implementation Order

Build in this exact order — each phase unblocks the next:

```
Phase 1: In-app onboarding   ← START HERE
    ↓ (users can now set up without docs)
Phase 2: Docker support
    ↓ (any OS can run it locally)
Phase 3: Railway template
    ↓ (cloud deployment becomes one-click)
Phase 4: .exe repackaging
    ↓ (Windows users get all new fixes)
Phase 5: License gate in web
    ↓ (cloud users are licensed like desktop users)
Phase 6: Marketing site + GitHub
    ↓ (product is publicly distributable)
```

---

## Token Administration (Existing — No Changes Needed)

The Supabase backend is already fully built. To issue a token to a new customer:

1. Log in to Supabase dashboard
2. Go to `tokens` table
3. Click "Insert row"
4. Fill in:
   - `token_key`: e.g. `BESTA-WKLY-ABCD1234`
   - `status`: `unclaimed`
   - `duration_days`: 7 (weekly), 30 (monthly), 180 (6mo), 365 (yearly)
   - `is_trial`: false
5. Send the `token_key` to the customer via WhatsApp

The customer's bot will automatically activate the token on first use and bind it to their
hardware ID. They cannot share it with another machine.

**Trial tokens** are auto-issued by the bot when the user enters `BESTA-FREE-TRIAL` —
no manual action needed.

---

## Revenue Model (Existing Pricing)

| Plan | Price | Duration |
|------|-------|----------|
| Trial | Free | 72 hours |
| Weekly | $5 | 7 days |
| Monthly | $18 | 30 days |
| 6 Months | $90 | 180 days |
| Yearly | $160 | 365 days |

Payment: WhatsApp → manual token issuance via Supabase dashboard.

Future upgrade: Integrate a payment link (Paystack for Nigeria, or Stripe) that
auto-creates and sends the token without manual admin work. Do this in a later phase.
