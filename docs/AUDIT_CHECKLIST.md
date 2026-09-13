# Audit & Launch Gate Checklist

## Pre-audit (complete before external review)

- [x] Unit tests: share mint/burn, first depositor, zero-share edge cases
- [x] Invariant tests: share price positive, pause enforcement
- [ ] Fork tests against Robinhood Chain mainnet state
- [ ] Oracle staleness revert tests
- [ ] Cashback budget exhaustion tests
- [ ] Slither static analysis

## Independent audit

- [ ] Engage auditor (budget 4-6 weeks)
- [ ] Remediate critical/high findings
- [ ] Re-audit if required
- [ ] Publish audit report

## Mainnet limited launch

- [ ] Deploy behind feature flags
- [ ] TVL cap: $1M
- [ ] Cashback budget: $100K
- [ ] 5-8 approved assets only
- [ ] Publish contract addresses
- [ ] 24/7 monitoring first 30 days

## Contract addresses (testnet)

Populate after deployment:

```
VaultFactory:
OracleAdapter:
CashbackReserve:
EmergencyRegistry:
ExecutionRouter:
```
