# Payment and Monetization System

This document summarizes how monetization works in the current app code. It is a working product/engineering reference, not a final pricing strategy.

## Current Status

WrapChat currently uses a credit-based access model.

There is a payment-mode UI with one-time pack prices, a free-trial credit flow, and upgrade screens, but there is no live checkout provider integrated yet. The payment button currently logs the selected packs to the console and shows a "Payment coming soon" toast.

In practical terms:

- Credits are the real access control mechanism today.
- Pack prices exist in the frontend as product/pricing copy.
- Payment processing, checkout sessions, webhooks, receipt handling, and automatic post-payment credit grants are not implemented yet.
- The app explicitly frames purchases as one-time purchases, not subscriptions.

## Access Modes

The app has one global access mode stored in Supabase `app_settings` under the `access_mode` key.

Supported modes:

| Mode | Label | Behavior |
| --- | --- | --- |
| `open` | Open Testing | Everyone can run reports without spending credits. Intended for internal QA. |
| `credits` | Credit Beta | Users need manually assigned credits. Admins can add or remove credits. |
| `payments` | Payment Launch | Users use trial or paid credits. The UI sends users to payment screens when they run out. |

The default/fallback mode is `credits`.

Admins can change the mode from the admin panel through the `admin_set_access_mode` Supabase RPC.

## Credits

Credits are stored per user in the Supabase `credits` table.

The frontend loads the signed-in user's balance from the `credits` table and keeps it in app state. Before running reports, the app refreshes the balance and checks whether the user has enough credits.

Admins bypass credit checks. Open Testing mode also bypasses credit checks.

When a paid/credit-gated analysis succeeds, credits are deducted through the `deduct_credits` RPC. Deduction happens after at least one selected report finishes successfully.

## Free Trial

In `payments` mode, a new user receives `1` initial credit when their credits row is created by the `initialise-credits` Edge Function.

That `1` credit is intended for a lightweight trial report:

- Report id: `trial_report`
- Display label: Quick Read
- Cost: `1` credit
- Output: a short AI snapshot with vibe, communication pattern, and one key takeaway
- The trial prompt caps the sampled chat to 80 messages to keep AI cost low

When a payments-mode user has exactly `1` credit and reaches the report selection flow, the app auto-runs the trial report instead of showing the normal pack selector.

After the trial credit is spent, the user is pushed toward upgrade/payment screens.

## Report Credit Pricing

Credit cost is centralized in `src/reportCredits.js`.

Standalone report costs:

| Report | Credit Cost |
| --- | ---: |
| `general` | 2 |
| `toxicity` | 2 |
| `lovelang` | 1 |
| `growth` | 2 |
| `accounta` | 2 |
| `energy` | 2 |
| `trial_report` | 1 |

The default fallback cost for an unknown report is `2` credits.

## Bundles and Credit Discounts

The app supports bundle-aware credit costs because some reports share AI analysis work.

Named bundles:

| Bundle | Reports | Credit Cost |
| --- | --- | ---: |
| Vibe Pack | `general`, `lovelang`, `energy` | 4 |
| Red Flags Pack | `toxicity`, `accounta` | 3 |
| Full Read | `general`, `lovelang`, `energy`, `toxicity`, `accounta`, `growth` | 8 |

If a selection exactly matches a named bundle, the fixed bundle cost is used.

If a selection does not match a named bundle, the fallback logic prices the first report in each AI family at full cost and each additional report in the same family at `1` extra credit.

AI families:

- `connection`: `general`, `lovelang`, `energy`
- `risk`: `toxicity`, `accounta`
- `growth`: `growth`
- `trial`: `trial_report`

## Payment Pack UI

The payment screen currently offers one-time analysis packs.

Frontend pack prices:

| Pack | Reports Included | Credits/Cost in App | Display Price |
| --- | --- | ---: | ---: |
| Vibe Pack | General Wrapped, Love Language, Energy | 4 credits | EUR 2.99 |
| Red Flags Pack | Toxicity, Accountability | 3 credits | EUR 2.49 |
| Full Read | all 6 full reports | 8 credits | EUR 5.99 |
| Growth Report | Growth only | 2 credits | EUR 1.49 |

The screen allows selecting quantities from 0 to 9 for each pack and calculates a displayed total.

Important: buying does not currently grant credits. The `Pay` button only calls a placeholder handler:

- logs `"Payment coming soon"` with selected packs, quantities, and total
- shows a temporary `"Payment coming soon"` toast

## Upgrade Flow

When a user does not have enough credits:

- In `credits` mode, the message says the user needs credits and should ask an admin.
- In `payments` mode, the message says the free trial or paid credits are used up and prompts the user to add credits.

The upgrade screen changes its copy and CTA based on access mode:

- Credit Beta: tells the user credits are managed by admin
- Payment Launch: opens the payment screen with an optional preselected pack

## Admin Credit Controls

Admins can view user balances through `admin_list_user_credits`.

Admins can add or remove credits through `admin_add_credits`, but the latest guard only allows this while the app is in `credits` mode. If the app is not in Credit Beta, admin credit editing returns:

`Switch to Credit Beta to adjust user credits.`

This means manual credit adjustment is meant for beta/testing, not for the future payment launch mode.

## Current Monetization Plan Implied by the Code

The app is moving toward:

1. A free quick-read trial for new users in Payment Launch mode.
2. One-time purchases of report packs.
3. No subscriptions or renewals.
4. Purchased analyses/credits that never expire.
5. Credits as the internal entitlement currency, even after real payments are added.

The likely production architecture is:

1. User selects one or more packs on the payment screen.
2. App creates a checkout session with a payment provider.
3. Payment provider confirms purchase through a secure webhook.
4. Backend grants the correct number of credits to the user's `credits` row.
5. User returns to the app and spends credits on report generation.

## Not Implemented Yet

The following pieces are not present in the current codebase:

- Stripe, Paddle, RevenueCat, Apple/Google in-app purchase, or any other payment provider integration
- Checkout session creation
- Payment webhook endpoint
- Orders/purchases table
- Receipt validation
- Automatic credit granting after payment
- Refund handling
- Tax/VAT handling
- Currency localization beyond hardcoded EUR display prices
- Subscription plans
- Server-side validation that paid pack ids/prices match trusted backend values

## Key Files

- `src/accessMode.js`: access mode constants, mode fetch/update helpers, and access checks
- `src/reportCredits.js`: report credit costs, bundle costs, and credit deduction helpers
- `src/App.jsx`: pack definitions, payment placeholder UI, upgrade flow, trial auto-run, and runtime credit checks
- `src/trialReport.js`: lightweight trial report prompt and derived output
- `supabase/functions/initialise-credits/index.ts`: creates/initializes user credits through an Edge Function
- `supabase/migrations/20260424143000_app_access_mode.sql`: global access mode storage and admin setter
- `supabase/migrations/20260424160000_trial_and_roles.sql`: trial credit initialization and user role support
- `supabase/migrations/20260424150000_batch_credit_deduction.sql`: atomic credit deduction RPC
- `supabase/migrations/20260425120000_guard_admin_credit_edits_by_access_mode.sql`: blocks admin credit edits outside Credit Beta
