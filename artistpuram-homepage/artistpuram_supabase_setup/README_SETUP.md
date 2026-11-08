# Artistpuram Supabase starter

These are integration files for your existing React + Vite website, not a replacement for your current App.jsx.

## Setup
1. Create a project at https://supabase.com/.
2. Copy its Project URL and publishable key from the project API/Connect settings.
3. If this is a new/empty project, run `supabase/migrations/20261014_artistpuram_core.sql` in the Supabase SQL Editor. If you already have `20261011_artist_puram_core.sql` or existing tables, inspect and merge first; do not run duplicate CREATE statements.
4. Copy `.env.example` to `.env` beside `package.json` and fill in the values.
5. Run `npm install @supabase/supabase-js`.
6. Copy `src/lib` and `src/services` into your existing `src` folder.
7. Restart Vite: `npm run dev`.

## Promote the owner's account
Register the owner's account through the app first, then verify the email if required. In Supabase SQL Editor, run this with the owner's exact email:
`update public.profiles set role = 'owner' where email = 'owner@example.com';`
Never let public sign-up choose its own role. Never put the service-role key or database password in frontend code.

## Before launch
The SQL enables RLS and deliberately blocks direct browser writes to bookings/payments. A trusted Supabase Edge Function still needs to validate workshop state/price/capacity, reserve seats atomically, create a Razorpay order, verify payment signatures/webhooks, and confirm the booking. Do not accept real payments until that server-side flow is implemented and tested.
