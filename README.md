# arc-land-backend

Backend API for an AI-powered land-clearing and construction takeoff quote system.

## Setup

```bash
cp .env.local.example .env.local
# fill in your API keys
npm install
npm run dev
```

## API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/api/geocode` | POST | Convert a street address to lat/lng coordinates |
| `/api/parcel-lookup` | POST | Look up parcel data (acreage, zoning, owner) for a given lat/lng and county |

## Stack

- Next.js 14 (App Router, TypeScript)
- Anthropic Claude SDK — AI-driven takeoff estimation
- Google Maps Geocoding API — address resolution
- Stripe — payment processing
- Zod — request validation
