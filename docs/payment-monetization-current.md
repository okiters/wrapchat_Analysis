# Payment and Monetization System

This document reflects the current app code as of Phase 1 of the Capacitor and RevenueCat readiness work. It is a working engineering reference, not a final pricing or app-store submission plan.

## Current Status

WrapChat currently uses a credit-based access model with persistent report-pack unlocks.

The app has:

- A payment-mode UI for buying credit bundles.
- A one-time Quick Read trial entitlement.
- Server-side pack unlocks stored in Supabase.
- Server-side credit deduction when packs are unlocked.
- A simulated credit purchase RPC for development.

The app does not yet have live payment processing. The payment screen currently grants credits through `simulateCreditPurchase`, which is a trusted Supabase RPC placeholder, not RevenueCat, Apple, Google, Stripe, or another payment provider.

In practical terms:

- Credits are the real access-control currency.
- Pack unlocks are the real read entitlement.
- Payment UI and credit simulation are implemented.
- Real checkout, RevenueCat SDK calls, webhooks, receipt/event validation, refund handling, and production purchase records are not implemented yet.

## Access Modes

The app has one global access mode stored in Supabase `app_settings` under the `access_mode` key.

Supported modes:

| Mode | Label | Behavior |
| --- | --- | --- |
| `open` | Open Testing | Everyone can run reports without spending credits. Intended for internal QA. |
| `credits` | Credit Beta | Users need manually assigned credits. Admins can add or remove credits. |
| `payments` | Payment Launch | Users use Quick Read, purchased credits, and unlocked report packs. |

The default/fallback mode is `credits`.

Admins can change the mode from the admin panel through the `admin_set_access_mode` Supabase RPC.

## Credits

Credits are stored per user in the Supabase `credits` table.

The frontend loads the signed-in user's balance and caches it locally for faster first render. Before important paid actions, the app refreshes the balance from Supabase.

Credits are used to unlock packs. Once a pack is unlocked, the entitlement is stored in `report_unlocks`, so the user can rerun/open that pack without relying only on their remaining credit balance.

Admins and open testing mode bypass normal credit checks.

## Quick Read Trial

Quick Read is no longer modeled as a normal purchased credit.

It is tracked as a separate one-time entitlement on the `credits` table:

- `quick_read_available`
- `quick_read_used_at`

New users start with `0` purchased credits and `quick_read_available = true`.

Quick Read details:

| Field | Value |
| --- | --- |
| Report id | `trial_report` |
| Display label | Quick Read |
| Credit cost | `0` |
| Output | Short AI snapshot with vibe, communication pattern, and one key takeaway |

The app consumes Quick Read through the `consume_quick_read_trial` RPC after a successful Quick Read run.

## Credit Bundles

Credit bundle definitions are centralized in `src/reportCredits.js`.

| Bundle | Credits | Display Price |
| --- | ---: | ---: |
| Starter | 100 | EUR 1.99 |
| Plus | 250 | EUR 3.99 |
| All Access | 450 | EUR 7.99 |

These are currently frontend product definitions plus a Supabase simulation mapping. They must become RevenueCat/App Store/Google Play products before production mobile launch.

Suggested future product ids:

| Bundle | Suggested Product ID |
| --- | --- |
| Starter | `credits_starter_100` |
| Plus | `credits_plus_250` |
| All Access | `credits_all_access_450` |

Because users can buy credits repeatedly, these should likely be configured as consumable in-app purchases in Apple/Google.

## Report Packs

Report pack definitions are centralized in `src/reportCredits.js`.

| Pack | Reports Included | Credit Cost |
| --- | --- | ---: |
| Growth Report | `growth` | 45 |
| Red Flags Pack | `toxicity`, `accounta` | 80 |
| Vibe Pack | `general`, `lovelang`, `energy` | 95 |
| Full Read | `general`, `lovelang`, `energy`, `toxicity`, `accounta`, `growth` | 210 |

Pack unlocks are persisted in `report_unlocks` with:

- `user_id`
- `pack_id`
- `credits_spent`
- `source`
- `unlocked_at`

The unique `(user_id, pack_id)` constraint prevents duplicate unlock rows for the same pack.

## Payment Screen

The payment screen currently offers credit bundles rather than direct report-pack purchases.

Current behavior:

1. User chooses a credit bundle.
2. App calls `purchaseCredits`.
3. `purchaseCredits` optimistically updates the local balance.
4. App calls `simulateCreditPurchase`.
5. Supabase adds credits to the user balance.
6. App confirms the new balance and shows a toast.

This is useful for development and QA, but it is not a real payment integration.

## Upgrade Flow

When a user does not have enough credits:

- In `credits` mode, the app points the user toward admin-managed beta credits.
- In `payments` mode, the app opens the credit purchase flow.

Users can unlock multiple selected packs with credits. The app calls `unlock_report_packs`, which deducts only the credits needed for packs the user does not already own.

## Current Backend RPCs

Key Supabase functions for monetization:

| Function | Purpose |
| --- | --- |
| `initialise_credits` | Creates/initializes the user credit row. |
| `consume_quick_read_trial` | Marks Quick Read as used. |
| `get_report_unlocks` | Returns pack ids the user owns. |
| `unlock_report_packs` | Atomically deducts credits and persists pack unlocks. |
| `simulate_credit_purchase` | Development-only credit grant for selected bundle ids. |
| `admin_add_credits` | Admin-only direct credit adjustment in Credit Beta mode. |

## RevenueCat Production Architecture

The intended mobile payment flow should be:

1. User signs in with Supabase.
2. RevenueCat SDK is configured with the Supabase user id as the App User ID.
3. App fetches the current RevenueCat Offering.
4. User purchases a credit product.
5. RevenueCat validates the store transaction.
6. RevenueCat sends a webhook to Supabase.
7. Supabase verifies the webhook authorization header.
8. Supabase maps the product id to a trusted server-side credit amount.
9. Supabase records the purchase transaction id/event id.
10. Supabase grants credits idempotently.
11. App refreshes the user's credit balance.

The frontend should not be the authority for granting paid credits.

## Not Implemented Yet

The following pieces are still required before real paid mobile launch:

- RevenueCat Capacitor SDK.
- RevenueCat project, apps, products, and offerings.
- App Store Connect in-app purchase products.
- Google Play Console in-app purchase products.
- Supabase RevenueCat webhook function.
- Purchase ledger table.
- Idempotent transaction handling.
- Refund/cancellation handling.
- Server-side product-id-to-credit mapping.
- Production build configuration for RevenueCat platform API keys.
- Test Store, Apple Sandbox/TestFlight, and Google Play Internal Testing verification.

Capacitor native app projects now exist under `ios/` and `android/`; see `docs/capacitor-mobile-setup.md`.

## Phase 1 Verification Snapshot

Local checks run during Phase 1:

| Check | Result |
| --- | --- |
| `npm run build` | Passes |
| `npm test` | Passes, 14/14 tests |
| `npm run lint` | Passes with warnings |

Main remaining lint warning categories:

- Existing unused variables/functions in the large `src/App.jsx` module.
- React compiler/hook lint warnings around refs and synchronous state updates.
- React Fast Refresh warnings for files that export both components and constants.
- A duplicate translation key and an undefined admin feedback setter were fixed during Phase 1.
- The lint config now treats cleanup/refactor guidance as warnings while keeping JavaScript correctness errors blocking.

## Key Files

- `src/reportCredits.js`: credit bundles, report packs, costs, and credit/unlock helpers.
- `src/App.jsx`: payment screen, upgrade flow, Quick Read trigger, pack unlock flow.
- `src/accessMode.js`: access mode constants and helpers.
- `supabase/functions/initialise-credits/index.ts`: initializes user credit profiles.
- `supabase/migrations/20260514120000_quick_read_entitlement.sql`: Quick Read entitlement model.
- `supabase/migrations/20260517120000_persistent_report_unlocks.sql`: pack unlocks and simulated purchase RPC.
- `supabase/migrations/20260518130000_admin_user_confirmation_status.sql`: admin user confirmation visibility.
