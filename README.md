# NexusSMM — SMM Reseller Panel

A production-ready Social Media Marketing (SMM) reseller panel built for Indian customers. Pay in ₹ INR via Razorpay/UPI or USDT crypto. Prices displayed in both INR and USD.

## Features

- **INR + USDT payments** — Razorpay (UPI/cards) converts INR → USD at admin-controlled rate. Cryptomus for USDT (1:1 USD).
- **340+ services** — import from any upstream SMM panel (Telegram, Instagram, YouTube, Facebook, VK, etc.)
- **Public API v2** — standard SMM panel API spec, resellers can plug your panel as their provider
- **BullMQ workers** — order forwarding, status polling every 2 min, refill processing, live exchange rate sync
- **Admin dashboard** — users, orders, services, providers, transactions, currency settings
- **2FA / Google OAuth** — TOTP with backup codes, Google Sign-In
- **Docker deploy** — single `docker compose up` starts all 7 containers

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14, TypeScript, Tailwind CSS, shadcn/ui, TanStack Query |
| Backend | Fastify, TypeScript, Prisma ORM |
| Database | PostgreSQL 16 |
| Cache/Queue | Redis 7 + BullMQ |
| Payments | Razorpay (INR) + Cryptomus (USDT) |
| Deploy | Docker Compose, Nginx, Let's Encrypt |

## Project Structure

```
nexussmm/
├── apps/
│   ├── api/          # Fastify backend (port 3001)
│   └── web/          # Next.js frontend (port 3000)
├── packages/
│   ├── db/           # Prisma schema + migrations
│   ├── queue/        # BullMQ queue definitions
│   └── types/        # Shared TypeScript types
├── nginx/            # Nginx config
├── docker-compose.yml
└── .env.example
```

## Quick Start (Development)

### Prerequisites
- Node.js 20+
- pnpm 9+
- PostgreSQL 16
- Redis 7
- Docker (for production)

### 1. Clone and install

```bash
git clone https://github.com/yourname/nexussmm.git
cd nexussmm
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your credentials
```

Key variables to set:
```env
DATABASE_URL=postgresql://user:pass@localhost:5432/nexussmm
REDIS_URL=redis://localhost:6379
JWT_SECRET=<generate with: openssl rand -hex 32>
TOTP_ENCRYPTION_KEY=<generate with: openssl rand -hex 32>
RAZORPAY_KEY_ID=rzp_test_xxxx
RAZORPAY_KEY_SECRET=xxxx
CRYPTOMUS_API_KEY=xxxx
CRYPTOMUS_MERCHANT_ID=xxxx
GOOGLE_CLIENT_ID=xxxx
GOOGLE_CLIENT_SECRET=xxxx
SMTP_HOST=smtp.gmail.com
```

### 3. Set up database

```bash
pnpm db:generate   # generate Prisma client
pnpm db:migrate    # run migrations
pnpm db:seed       # seed default data + admin user
```

Default admin: `admin@nexussmm.com` / `Admin@123456`

### 4. Run development

```bash
# Terminal 1 — API server
pnpm --filter @nexussmm/api dev

# Terminal 2 — BullMQ workers
pnpm --filter @nexussmm/api start:worker

# Terminal 3 — Next.js frontend
pnpm --filter @nexussmm/web dev
```

Open http://localhost:3000

---

## Production Deploy (Docker)

### 1. Server requirements
- Ubuntu 22.04 VPS (min 2 vCPU, 4GB RAM) — Hetzner CX22 or OVH VPS recommended
- Docker + Docker Compose installed
- Domain name pointed to server

### 2. Prepare environment

```bash
cp .env.example .env
# Fill ALL values in .env
# Generate secrets:
openssl rand -hex 32   # for JWT_SECRET, COOKIE_SECRET
openssl rand -hex 32   # for TOTP_ENCRYPTION_KEY
```

### 3. First-time SSL setup

```bash
# Get certificate before starting nginx
docker compose run --rm certbot certonly \
  --webroot -w /var/www/certbot \
  -d yourdomain.com \
  --email admin@yourdomain.com \
  --agree-tos --non-interactive
```

### 4. Deploy

```bash
docker compose up -d --build
```

### 5. Run migrations and seed

```bash
docker compose exec api npx prisma migrate deploy \
  --schema ../../packages/db/prisma/schema.prisma
docker compose exec api node dist/worker-entrypoint.js --seed
```

### 6. Verify

```bash
docker compose ps        # all 7 containers healthy
curl https://yourdomain.com/health   # {"status":"ok"}
```

---

## Currency Flow

```
Customer pays ₹1000 via Razorpay/UPI
         ↓
Panel converts at admin rate: ₹85 × (1 + 5% markup) = ₹89.25 / $1
         ↓
$11.20 USD credited to wallet
         ↓
User orders 1000 members @ $0.32/1000
         ↓
Panel forwards to provider → pays $0.175/1000
Profit: $0.32 - $0.175 = $0.145 per order
```

Admin controls: **Settings → Currency** to set INR rate, markup %, and auto-update frequency.

---

## Adding Your First Provider

1. Go to **Admin → Providers → Add Provider**
2. Enter: Name, API URL (`https://smm.plus/api/v2`), API Key
3. Click **Test** to verify connectivity
4. Click **Sync Services** to import the service catalog
5. Go to **Admin → Services** to enable services and set markup

---

## Public API v2

Resellers can use your panel as a provider. Standard SMM panel API v2 spec.

**Endpoint:** `POST https://yourdomain.com/api/v2`

| Action | Description |
|---|---|
| `action=services` | List all enabled services |
| `action=add` | Place an order |
| `action=status` | Check order status |
| `action=multi_status` | Check up to 100 orders |
| `action=refill` | Request refill |
| `action=cancel` | Cancel orders |
| `action=balance` | Get wallet balance (USD) |

Users generate API keys under **Profile → API Key**.

---

## Environment Variables Reference

See [.env.example](.env.example) for full documentation of all variables.

---

## Security Notes

- All passwords hashed with bcrypt (rounds=12)
- TOTP secrets encrypted at rest with AES-256-GCM
- API keys stored as SHA-256 hashes
- Provider API keys encrypted with AES-256-GCM
- Webhook signatures verified (Razorpay HMAC-SHA256, Cryptomus MD5)
- Wallet deductions use PostgreSQL `SELECT FOR UPDATE` to prevent race conditions
- CSRF protection via SameSite=Strict cookies
- Rate limiting on login (5 attempts / 15 min) and API v2 (60 req/min)
