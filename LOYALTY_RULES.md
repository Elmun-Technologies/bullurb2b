# Loyalty rules

## Defaults

- Metric: net fulfilled box quantity.
- Period: current calendar month.
- Timezone: `Asia/Tashkent`.
- Tiers (minimum inclusive threshold / discount): Standard 0 / 0%, Silver 50 / 3%, Gold 100 / 5%, Platinum 200 / 7%, VIP 500 / 10%.
- Thresholds are editable in the demo settings and must be strictly increasing; discounts must be from 0 through 100.

## Period and qualifying sales

The period helper calculates calendar-month boundaries in the configured timezone; rolling 30/90-day options are also supported by the domain API. Only completed/fulfilled eligible sales qualify. Draft, cancelled and rejected orders do not. Returns subtract from net volume and revenue when the source records provide return quantities. Metric aggregation and order eligibility are centralized in `src/lib/domain/loyalty.ts`; components do not implement their own tier logic.

## Upgrade / downgrade

Upgrades are immediate when new eligible volume crosses a threshold. Downgrades are deferred until the next period boundary; an existing customer's held tier can be supplied as the prior tier. In the demo, a separate fulfillment simulation demonstrates 82 + 20 = 102 boxes and the Silver → Gold upgrade. In a live integration, creating a draft order alone must not upgrade the tier.

## Progress

Progress is calculated against the next threshold and clamped to 0–100%. Remaining volume is `max(0, threshold - currentValue)`. At the highest tier, the next tier and remaining value are absent and progress is complete. Turnover mode uses the same engine and integer UZS.

## Pricing precedence

Resolve the standard B2B price. A valid customer-specific negotiated price overrides loyalty pricing (no stacked discount). Otherwise, apply the current tier discount using integer UZS rounding. The result reports the selected source and discount metadata. Currency values are never represented as floating-point fractions.

## Configuration validation

Require at least one active tier, a zero-threshold entry tier, unique names/thresholds, ascending non-negative thresholds and integer discount values between 0 and 100. Tier colors/descriptions are presentation only and never affect business rules.