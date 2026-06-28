# Besta Bot
> Automated IQ Option trading bot with Double Martingale strategy

## Quick Start

### Option A: Windows Desktop
1. [Download BestaBot.exe](https://bestabot.com)
2. Run the application
3. Enter your license key (`BESTA-FREE-TRIAL` for 72h free)
4. Enter your IQ Option credentials
5. Click Start

### Option B: 24/7 Cloud (Railway)
[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/XXXXXXX)

### Option C: Self-hosted (Docker)
```bash
git clone https://github.com/wixsta/iqoption
cp .env.example .env
# Edit .env with your credentials
docker-compose up -d
open http://localhost:5000
```

## License
72-hour free trial — enter `BESTA-FREE-TRIAL` on first launch.

Purchase at [bestabot.com](https://bestabot.com) or via [WhatsApp](https://wa.me/2347010102053).

## Pricing

| Plan | Price |
|------|-------|
| Trial | Free (72h) |
| Weekly | $5 |
| Monthly | $18 |
| 6 Months | $90 |
| Yearly | $160 |

## Documentation
- `docs/PROGRESS_LOG.md` — full history of every feature and bug fix
- `docs/PRODUCT_PLAN.md` — distribution roadmap
- `docs/ARCHITECTURE_REFACTOR.md` — modularisation plan
- `SETUP_GUIDE.md` — deployment instructions
- `FRAMEWORK.md` — trading strategy rules (source of truth)
