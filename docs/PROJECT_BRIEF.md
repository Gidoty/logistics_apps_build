# Project Brief: Cross-Border Shopping and Delivery Platform

Working name: **[APP_NAME]** (placeholder, final name to be set later)

Read this file fully before writing any code. It is the background for every batch of instructions you will receive. Do not build ahead of the current batch.

---

## 1. Executive Summary

We are building a web platform that lets a person anywhere in the world buy goods from sellers in Nigeria, China and other countries, pay in their own currency, and have the goods delivered to any address in Nigeria (and later, other countries). Physical delivery is handled by existing logistics partners. We do not own riders, trucks or warehouses. Our product is the ordering, pricing, payment, trust and tracking layer that sits on top of those partners.

The first product category is **electronics** (phones, laptops, accessories, small appliances, solar and power gear), with general goods allowed from day one.

The main users are:

- **Diaspora buyers**: Nigerians in the UK, US, Canada, China and elsewhere who pay for goods delivered to family or businesses in Nigeria.
- **Local buyers in Nigeria**: people who want electronics from China or other markets without dealing with agents, freight forwarders and customs themselves.
- **Recipients**: the person who receives the goods. The payer and the recipient are often different people.
- **Vendors**: verified sellers in Nigeria, China and other countries who list products.
- **Admin / operations team**: us. We approve vendors, prepare quotes, manage orders, and update shipment status from partners.

The budget is tight. The build must be light, cheap to host, and easy to extend. Start small, keep the code clean, and design so we can add countries, currencies, logistics partners and native mobile apps later without rewrites.

---

## 2. The Problem We Solve

Buying electronics from China or sending goods to family in Nigeria today usually means:

1. Finding a seller you can trust.
2. Paying an agent through a bank transfer with no protection.
3. Guessing the final cost, because freight, customs duty and local delivery fees show up later.
4. Receiving a fake, damaged or wrong item with no recourse.
5. Chasing the agent on WhatsApp for tracking updates.

Our platform fixes each step: verified vendors, one all-inclusive price before payment, protected payment, inspection proof before shipping, and one tracking page.

---

## 3. Core Features (What Makes This Different)

These are the features that set us apart. Every batch should respect them.

### 3.1 Two ways to order

- **Catalog order**: buy from products listed by verified vendors on the platform.
- **Link order ("Buy it for me")**: paste a product link from any online store (Jumia, Konga, AliExpress, Amazon, 1688 and others). The system saves the link and fetches only basic public preview data (title, image) where available. An admin then prepares a quote manually. Do not build scrapers that break store terms of service. Manual quoting is fine for the first version.

### 3.2 Landed-cost quote

Before payment, the buyer sees one final price in their own currency, broken into lines:

- Item price
- Service fee
- International freight (if cross-border)
- Estimated customs duty and clearing
- Last-mile delivery in Nigeria
- FX conversion note

Each quote has an expiry (default 48 hours) because exchange rates and freight prices move. All fee rates, duty estimates and FX overrides are admin-configurable in the database. Never hardcode rates.

### 3.3 Protected payment (escrow ledger)

The buyer's payment is held on the platform. The vendor is paid only after the recipient confirms delivery. We record this in an internal ledger (held, released, refunded). The ledger must be append-only and auditable. Real money moves through payment providers. The ledger tracks the state.

### 3.4 Pre-shipment inspection proof

For electronics, the vendor or our agent uploads photos or a short video before shipping: item powered on, serial number or IMEI visible, packaging sealed. The buyer can view this proof and approve or raise a dispute before the item ships. This is our main trust feature.

### 3.5 Payer and recipient are separate

The buyer abroad enters the recipient's name, phone and address in Nigeria. The recipient gets a delivery code (OTP) by SMS or email. The rider or partner collects this code at the door. Entering the code confirms delivery and triggers vendor payout.

### 3.6 Partner-agnostic logistics

Logistics partners are plugged in through an adapter interface. Version one uses a **manual adapter**: admin updates shipment status and tracking numbers by hand. Later, we add API adapters for partners (for example GIG Logistics, DHL, or China-to-Nigeria freight forwarders) without changing order logic.

### 3.7 One tracking page

Buyer and recipient see one timeline: Paid, Purchased, Inspected, Shipped, In Transit, Arrived Nigeria, Customs Cleared, Out for Delivery, Delivered. The recipient can open a public tracking link without creating an account.

### 3.8 Consolidation (later batch, design for it now)

Buyers can group several orders into one shipment to cut freight cost. The data model should allow many orders to belong to one shipment from the start.

---

## 4. Trade Corridors

A corridor is an origin country plus a destination country, each with its own fees, freight rates and delivery times. Store corridors in the database.

Launch corridors:

1. **China to Nigeria** (electronics focus)
2. **Nigeria to Nigeria, paid from abroad** (diaspora buyer pays for local goods delivered to family)

Future corridors (design for them, do not build now): UK, US, UAE to Nigeria; Nigeria to UK and US.

---

## 5. Technical Stack

Keep it light and cheap. One codebase to start.

- **Framework**: Next.js (App Router) with TypeScript, strict mode.
- **Styling**: Tailwind CSS with shadcn/ui components.
- **App type**: Responsive web app built as a PWA (installable on phones). No native mobile apps in version one.
- **Backend and database**: Supabase (Postgres, Auth, Storage, Realtime). Use Row Level Security on every table.
- **Payments**: Build a payment provider interface. First implementation: Paystack (NGN). Second: Flutterwave (multi-currency, for diaspora cards). Keep providers swappable.
- **Currency**: Base currency NGN. Display prices in USD, GBP, CAD, CNY, EUR and NGN. FX rates from a free rates API with admin override. Store all money as integers in the smallest unit (kobo, cents). Never use floats for money.
- **Email**: Resend. **SMS**: a provider interface (Termii as first option for Nigeria).
- **Hosting**: Vercel (app) and Supabase (data). Both have free tiers to start.
- **Validation**: Zod on every input.
- **Testing**: Vitest for logic (especially pricing and ledger). Playwright for the main buyer flow.

---

## 6. User Roles

One app, role-based access:

| Role      | Can do                                                                                                           |
| --------- | ---------------------------------------------------------------------------------------------------------------- |
| Buyer     | Browse, request link quotes, pay, track, confirm or dispute                                                      |
| Recipient | View tracking via link, provide delivery code                                                                    |
| Vendor    | Manage listings, accept orders, upload inspection proof, see payouts                                             |
| Admin     | Approve vendors, prepare quotes, set fees and FX, update shipments, resolve disputes, release or refund payments |

---

## 7. Build Plan (Batches)

You will receive these one at a time. Finish, test and summarize each batch before the next.

1. Project setup, database schema, auth and roles
2. Vendor onboarding and product catalog
3. Link order ("Buy it for me") and admin quoting
4. Landed-cost pricing engine and currency handling
5. Checkout, payments and escrow ledger
6. Order lifecycle, inspection proof and logistics adapter
7. Tracking page, recipient delivery code and notifications
8. Admin dashboard and vendor dashboard
9. Security review, tests, PWA setup and deployment

---

## 8. Rules for Every Batch

1. Only build what the current batch asks for. List anything you think is missing at the end instead of building it.
2. Use TypeScript strict mode. No `any` unless you explain why.
3. Money is always integers in the smallest unit, with a currency code stored next to it.
4. Every Supabase table has Row Level Security enabled with explicit policies.
5. Secrets live in environment variables. Keep `.env.example` updated. Never commit real keys.
6. Write tests for all pricing, fee, FX and ledger logic.
7. Keep functions small and named clearly. Put business logic in `/lib`, not inside UI components.
8. Mobile-first UI. Most buyers and recipients will use phones on slow networks. Keep pages light.
9. At the end of each batch, give a short report: what you built, files changed, how to test it, and open questions.
10. If a requirement is unclear, ask before guessing on anything involving money, security or data structure.
