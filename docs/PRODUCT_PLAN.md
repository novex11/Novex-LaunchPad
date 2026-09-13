# Novex

## Tokenized-Stock Basket Protocol

**Product plan and concept specification**  
**Status:** Product definition for discussion  
**Version:** Initial fee-free MVP concept

---

## 1. Executive Summary

Novex is an onchain managed-stock protocol that allows a user to deposit one supported tokenized stock and convert its value into a diversified basket of tokenized stocks.

The user:

1. Deposits a supported tokenized stock, such as NVDA.
2. Selects a risk profile: Defensive, Balanced, or Aggressive.
3. Selects preferred stock tokens, such as Apple, Microsoft, and SanDisk.
4. Reviews the proposed basket allocation.
5. Receives a Novex vault receipt token representing ownership of the managed basket.
6. Receives stock-token cashback funded by Novex.
7. Keeps 100% of the basket's investment performance.
8. Can later redeem the current basket value into the original deposit asset, a supported stable asset, or the underlying basket.

Example:

```text
Deposit:                $500 of NVDA
Selected strategy:      Balanced
Preferred stocks:       Apple, Microsoft, SanDisk
Deposit Stockback:      $2.00
Allocation Stockback:   $3.10
Opening position:       $505.10 before external execution costs
Receipt token:          nNVDA-B
```

Novex does not charge a deposit fee, management fee, performance fee, or platform redemption fee in the proposed version. All positive basket performance belongs to the user.

Novex is not currently planning sponsored stock campaigns. The initial cashback program has only two layers:

- **Deposit Stockback**
- **Allocation Stockback**

---

## 2. The Product in One Sentence

> Deposit one tokenized stock, receive a managed basket plus stock-token cashback, and keep 100% of the portfolio's investment performance.

Alternative short positioning:

> Turn one stock into a smarter onchain portfolio.

---

## 3. The Problem

Tokenized-stock users may hold a concentrated position in a single company. Diversifying that position normally requires the user to:

- Decide which assets to buy.
- Sell part of the original position.
- Execute several individual transactions.
- Calculate allocations.
- Monitor portfolio risk.
- Rebalance the portfolio over time.
- Manage small stock-token balances.
- Track the performance of the complete portfolio.

This is difficult for users who want stock exposure but do not want to actively manage several positions.

Existing DeFi vaults often add further complexity through:

- Unclear yield sources.
- Complicated reward tokens.
- High or hidden fees.
- Unverifiable offchain custody.
- Unclear redemption mechanics.
- Promised returns that are not economically guaranteed.

Novex is intended to provide a simpler and more transparent experience:

```text
One deposit
+ one risk selection
+ user preferences
= one managed stock basket
```

---

## 4. The Novex Solution

Novex transforms a supported tokenized stock into a managed, diversified basket held inside an onchain vault.

The protocol separates the product into four clear layers:

### 4.1 Deposit Layer

The user deposits a supported tokenized stock such as NVDA.

### 4.2 Strategy Layer

The user selects Defensive, Balanced, or Aggressive and optionally identifies preferred and excluded stocks.

### 4.3 Vault Layer

The vault retains any required allocation of the deposited stock and swaps the remaining value into other approved stock tokens according to the selected strategy.

### 4.4 Ownership Layer

The user receives a Novex receipt token representing a proportional share of the vault's current net asset value.

---

## 5. Core User Journey

### Step 1: Connect a Wallet

The user connects a compatible wallet. The wallet is the user's account; an email account is not required for the core onchain experience.

### Step 2: Select a Deposit Asset

The user selects a supported tokenized stock:

```text
NVDA
AAPL
MSFT
SPY
QQQ
Other approved tokenized stocks
```

Only assets that satisfy Novex's liquidity, pricing, settlement, and contract-safety requirements should be supported.

### Step 3: Enter a Deposit Amount

Example:

```text
Deposit asset: NVDA
Deposit value: $500
```

Before confirmation, the interface should display:

- Current asset price.
- Estimated external swap costs.
- Estimated network cost.
- Estimated price impact.
- Proposed basket.
- Expected Novex cashback.
- Minimum received values.

### Step 4: Choose a Risk Profile

The user chooses one of three strategies:

- Defensive
- Balanced
- Aggressive

### Step 5: Choose Stock Preferences

The user can select preferred stocks:

```text
Preferred:
✓ Apple
✓ Microsoft
✓ SanDisk
```

The user may also exclude supported stocks:

```text
Do not include:
✕ Tesla
```

Preferences guide the allocation engine but do not override the strategy's risk, liquidity, concentration, or safety limits.

### Step 6: Review the Proposed Basket

Example:

```text
NVDA        20%   $100
Apple       25%   $125
Microsoft   25%   $125
SanDisk     15%    $75
SPY         15%    $75
-----------------------
Total             $500
```

The preview must also explain why each asset was included and whether it was:

- Selected by the user.
- Added for diversification.
- Added for risk control.
- Retained from the deposit.

### Step 7: Review Cashback

Example:

```text
Deposit Stockback:       $2.000
Allocation Stockback:    $2.625
Total Novex Stockback:   $4.625
```

The reward calculation must be visible before confirmation.

### Step 8: Confirm the Deposit

After confirmation:

1. NVDA is transferred to the appropriate smart-contract vault.
2. The target allocation is calculated.
3. The required NVDA allocation remains in the vault.
4. The remaining NVDA is swapped into approved stock tokens.
5. Novex adds the applicable cashback assets.
6. The vault mints receipt tokens to the user.

### Step 9: Manage the Position

The user can monitor:

- Current portfolio value.
- Receipt-token balance.
- Current allocation.
- Basket investment performance.
- Deposit Stockback.
- Allocation Stockback.
- External execution costs.
- Rebalance history.
- Redemption value.

### Step 10: Redeem

The user burns the receipt token and receives the current value of the position through one of the supported redemption methods.

---

## 6. How One Stock Becomes a Basket

The deposited stock is not duplicated. To obtain other assets, the vault must normally swap part of the deposited stock into those assets.

Example:

```text
User deposits: 1 NVDA worth $500
Target NVDA allocation: 20%
```

Execution:

```text
$100 of NVDA remains in the vault
$400 of NVDA is routed into approved markets

$125 → Apple
$125 → Microsoft
 $75 → SanDisk
 $75 → SPY
```

The stock tokens remain inside the vault. The user does not need to hold and manage five separate wallet positions.

The user's receipt token proves proportional ownership of the basket.

### 6.1 Execution Requirements

The execution system should enforce:

- Approved input and output assets.
- Maximum price impact.
- Maximum slippage.
- Minimum liquidity.
- Minimum output amounts.
- Oracle-price deviation limits.
- Transaction deadlines.
- Strategy allocation limits.
- Emergency pause conditions.

### 6.2 Platform Fee vs. External Execution Cost

Novex does not charge platform fees in the proposed version.

However, external costs may still exist:

- Blockchain gas.
- Liquidity-pool trading fees.
- Market spread.
- Slippage.
- Price impact.

These are not Novex revenue. They should be estimated and shown before the user confirms.

---

## 7. Risk Strategies

The strategy names describe relative risk. They do not guarantee a profit or protection from loss.

## 7.1 Defensive

**Goal:** Reduce concentration and volatility while maintaining tokenized-stock exposure.

Illustrative limits:

```text
Large-cap stock tokens:       40%–50%
Broad-market stock assets:    25%–35%
Stable reserve:               15%–25%
Maximum single stock:              15%
```

Possible behavior:

- Higher diversification.
- Lower single-stock concentration.
- Larger stable reserve.
- Lower rebalance frequency.
- Preference for deeper-liquidity assets.

The term "Defensive" is preferable to "Low Risk" because no stock portfolio is risk-free.

## 7.2 Balanced

**Goal:** Balance growth opportunities with diversification and concentration limits.

Illustrative limits:

```text
Large-cap stock tokens:       50%–65%
Growth stock tokens:          20%–30%
Broad-market stock assets:    10%–20%
Stable reserve:                5%–10%
Maximum single stock:              25%
```

Balanced should be the default option for users who do not select a strategy.

## 7.3 Aggressive

**Goal:** Seek higher growth potential while accepting higher volatility and drawdown risk.

Illustrative limits:

```text
Growth stock tokens:          60%–80%
Thematic positions:           10%–25%
Stable reserve:                 0%–5%
Maximum single stock:              35%
```

The interface must clearly explain:

- Higher potential volatility.
- Higher concentration.
- Greater possible losses.
- More frequent allocation changes.

---

## 8. Preference System

User preferences personalize the basket without removing protocol-level protections.

### 8.1 Preferred Stocks

A preferred stock receives increased consideration when:

- It is approved by Novex.
- It has sufficient liquidity.
- Its price data is reliable.
- It fits the selected strategy.
- Adding it does not violate concentration limits.

### 8.2 Excluded Stocks

An excluded stock should not be purchased for that user's position unless the user later removes the exclusion.

### 8.3 Preference Is Not a Guaranteed Allocation

Novex should communicate:

> We prioritize your selected stocks when they satisfy the strategy's risk, liquidity, and concentration rules.

Selecting Microsoft does not guarantee that Microsoft will receive a fixed percentage. Allocation depends on the complete basket and current execution conditions.

---

## 9. Receipt Tokens

The user receives a vault receipt token after depositing.

Example naming:

```text
nNVDA-D   Novex NVDA-funded Defensive position
nNVDA-B   Novex NVDA-funded Balanced position
nNVDA-A   Novex NVDA-funded Aggressive position
```

The final naming system may use the selected strategy rather than the deposit asset if vault architecture requires pooled strategy vaults.

### 9.1 What the Receipt Token Represents

The receipt token represents:

- A proportional claim on the vault's assets.
- The user's share of current vault net asset value.
- The right to redeem according to the vault's rules.

It does not necessarily represent:

- A fixed quantity of the original deposit asset.
- A one-to-one NVDA peg.
- A guaranteed dollar value.
- A guaranteed profit.

### 9.2 Share Calculation

At deposit:

```text
Shares minted = Net contributed value ÷ Current share price
```

Example:

```text
Current vault share price: $1.00
Net contributed value:     $504.625
Receipt tokens minted:     504.625
```

If the basket grows:

```text
New vault share price: $1.10
504.625 shares:        $555.0875
```

### 9.3 Burning on Redemption

When the user redeems:

1. Receipt tokens are transferred to the vault.
2. The receipt tokens are burned.
3. The user's proportional underlying value is calculated.
4. The chosen redemption method is executed.
5. Assets are transferred to the user's wallet.

---

## 10. Cashback Program

The current product includes only two cashback layers.

Novex is not currently offering sponsored stock campaigns, issuer campaigns, or third-party campaign marketplaces.

## 10.1 Layer A: Deposit Stockback

Deposit Stockback is a Novex-funded bonus awarded when an eligible deposit is completed.

Example:

```text
Eligible deposit:       $500 NVDA
Deposit Stockback:      $2 of an approved stock token
```

The reward may be:

- Added to the user's basket.
- Denominated in a supported stock selected by Novex.
- Denominated in one of the user's preferred stocks.
- Subject to an eligibility floor and per-wallet limit.

Recommended initial rule:

```text
Minimum eligible deposit:  Published before deposit
Reward value:              Fixed dollar value
Wallet limit:              Published and enforced
Reward budget:             Limited and visible internally
```

The reward's dollar value should be known before the user confirms.

## 10.2 Layer B: Allocation Stockback

Allocation Stockback is awarded when the vault purchases an eligible stock token as part of the user's initial basket allocation.

Example:

```text
Microsoft purchased:      $125
Cashback rate:             0.50%
Microsoft bonus:           $0.625
```

Formula:

```text
Allocation Stockback =
Eligible purchased amount × Published cashback rate
```

Additional examples:

```text
Apple purchased:          $125
Apple cashback rate:       1.00%
Apple bonus:               $1.250

SanDisk purchased:         $75
SanDisk cashback rate:      1.00%
SanDisk bonus:              $0.750
```

Total:

```text
Microsoft bonus:  $0.625
Apple bonus:      $1.250
SanDisk bonus:    $0.750
------------------------
Total:            $2.625
```

### 10.3 Cashback Asset

The cleanest rule is:

```text
Apple allocation      → Apple Stockback
Microsoft allocation  → Microsoft Stockback
SanDisk allocation    → SanDisk Stockback
```

This allows Novex to say:

> When your basket buys an eligible stock, you receive more of that stock.

### 10.4 Where Cashback Goes

Cashback should normally be added directly to the user's vault position.

Example:

```text
User deposit:             $500.000
Deposit Stockback:          $2.000
Allocation Stockback:       $2.625
Opening position:         $504.625
```

Benefits:

- Cashback begins participating in basket performance.
- Users avoid several dust transfers.
- No separate claim transaction is required.
- Reward accounting remains connected to the relevant position.
- The opening portfolio value is easy to verify.

### 10.5 Cashback Is Not Investment Profit

The interface must separate:

```text
Basket investment performance
Novex Deposit Stockback
Novex Allocation Stockback
External execution costs
```

Novex should not combine cashback and market performance into a misleading annual yield figure.

### 10.6 Cashback Limits

The protocol should support:

- Minimum eligible deposit.
- Maximum rewarded deposit amount.
- Maximum reward per wallet.
- Maximum reward per period.
- Total Novex reward budget.
- Duplicate-transaction prevention.
- Self-referral and sybil controls if referrals are added later.

### 10.7 No Stock Campaigns in the Current Version

The following are explicitly outside the current plan:

- Sponsored ticker campaigns.
- Stock issuer campaigns.
- Creator-funded stock campaigns.
- A public campaign marketplace.
- Variable promotional campaigns controlled by outside parties.

These may be evaluated later but must not be included in the initial product scope.

---

## 11. User Returns

All basket investment performance belongs to the user.

The position is calculated as:

```text
Initial user deposit
+ Deposit Stockback
+ Allocation Stockback
+ stock price gains
+ supported distributions
- stock price losses
- unavoidable external execution costs
= current user position value
```

Example:

```text
User deposit:               $500.00
Deposit Stockback:            $2.00
Allocation Stockback:         $2.63
External execution costs:    -$0.80
Opening net position:        $503.83
Basket market performance:   +$46.17
Current position value:      $550.00
Novex performance fee:         $0.00
```

The full $550 position belongs to the user.

---

## 12. Fee Policy

The proposed Novex version charges no platform fees.

```text
Deposit fee:       0%
Management fee:    0%
Performance fee:   0%
Platform exit fee: 0%
```

Novex must not describe external market or network costs as zero.

The confirmation screen should distinguish:

```text
Novex platform fee:          $0.00
Estimated network cost:      $X.XX
Estimated market cost:       $X.XX
Estimated total received:    $X.XX
```

The long-term business and cashback funding model must be defined separately before production launch. The fee-free product should not promise an unlimited cashback program.

---

## 13. Portfolio Management

Novex may rebalance baskets to keep them within the selected strategy.

### 13.1 Reasons to Rebalance

- A stock exceeds its maximum allocation.
- A stock falls below liquidity requirements.
- An asset becomes unsupported.
- The user's selected strategy changes.
- A user changes preferences.
- Portfolio concentration moves outside allowed limits.
- Stable-reserve limits need restoration.

### 13.2 Rebalance Constraints

Every rebalance should enforce:

- Minimum time between routine rebalances.
- Maximum turnover per rebalance.
- Maximum price impact.
- Maximum slippage.
- Approved asset list.
- Strategy concentration limits.
- Oracle deviation limits.
- Emergency stop conditions.

### 13.3 Rebalance Transparency

The user should be able to view:

```text
Previous allocation
New allocation
Reason for rebalance
Assets bought
Assets sold
Execution cost
Transaction hash
Time completed
```

### 13.4 Changing Strategies

A user may change from one strategy to another.

Example:

```text
Current: Balanced
New: Aggressive
```

Before confirmation, Novex should display:

- Target allocation changes.
- Estimated trades.
- Estimated external costs.
- Expected receipt-token conversion.

If each strategy uses a different vault, the operation may burn one receipt token and mint another.

---

## 14. Redemption

Users redeem the current value of the managed basket, not a guaranteed original quantity of the deposit asset.

### 14.1 Redeem Into the Original Deposit Asset

Example:

```text
Original deposit asset: NVDA
Current basket value:   $550
Current NVDA price:     $500
Estimated redemption:  1.10 NVDA before external costs
```

If NVDA outperforms the basket:

```text
Current basket value:   $550
Current NVDA price:     $650
Estimated redemption:  0.846 NVDA before external costs
```

Correct product promise:

> Redeem your current portfolio value in NVDA.

Incorrect product promise:

> Always receive the original number of NVDA plus basket profit.

Guaranteeing the original NVDA quantity would require a separate hedged or principal-protection product.

### 14.2 Redeem Into a Supported Stable Asset

The vault converts the user's proportional position into a supported stable asset.

This provides a simple value-based exit but may require several swaps.

### 14.3 Redeem the Underlying Basket

The vault transfers the user's proportional share of each stock token.

Benefits:

- Fewer forced conversions.
- Potentially lower price impact.
- More direct ownership of the underlying assets.

Challenges:

- The user receives several assets.
- Very small positions may create dust amounts.

### 14.4 Redemption Preview

Before confirmation, show:

```text
Receipt tokens to burn
Current gross position value
Expected output asset
Estimated external execution costs
Minimum amount received
Estimated completion method
```

---

## 15. Smart-Contract Architecture

The production system should keep user assets in smart contracts rather than an unrestricted backend-controlled wallet.

Potential components:

### 15.1 Vault Factory

Creates or registers approved vaults and their configurations.

### 15.2 Strategy Vault

Holds tokenized stocks, mints and burns receipt tokens, and tracks vault shares.

### 15.3 Allocation Controller

Enforces strategy limits and validates proposed allocations.

### 15.4 Execution Router

Routes approved stock-token swaps while enforcing slippage and price-impact limits.

### 15.5 Cashback Reserve

Holds Novex-funded reward inventory and transfers Deposit and Allocation Stockback into eligible vault positions.

### 15.6 Oracle Adapter

Collects approved price data for:

- Deposit valuation.
- Share minting.
- Allocation validation.
- Cashback calculation.
- Redemption preview.
- Risk monitoring.

### 15.7 Receipt Token

Represents proportional ownership of a defined vault.

### 15.8 Emergency Controls

Emergency controls may pause:

- New deposits.
- New swaps.
- Routine rebalancing.
- Cashback distribution.

Where safely possible, emergency controls should not permanently block users from withdrawing their proportional underlying assets.

---

## 16. Backend Responsibilities

The backend may:

- Collect market and liquidity data.
- Calculate proposed allocations.
- Calculate cashback previews.
- Monitor strategy limits.
- Propose rebalances.
- Index transaction history.
- Provide portfolio analytics.
- Submit restricted onchain transactions.

The backend should not have unrestricted power to:

- Withdraw user assets.
- Send assets to unapproved addresses.
- Buy unapproved tokens.
- Ignore concentration limits.
- Change strategy rules without controls.
- Change historical cashback calculations.

Smart contracts should enforce the critical financial rules.

---

## 17. Transparency Requirements

Each vault should provide a public page showing:

- Vault strategy.
- Supported assets.
- Current holdings.
- Current asset weights.
- Total assets.
- Receipt-token supply.
- Share price.
- Strategy limits.
- Rebalance history.
- Cashback added.
- Smart-contract addresses.
- Pause status.

Each user position should show:

- Deposit history.
- Receipt tokens minted.
- Opening basket.
- Current basket.
- Cashback received.
- Investment profit or loss.
- External execution costs.
- Redemption history.

---

## 18. Risk Disclosures

Novex should clearly disclose:

### 18.1 Market Risk

Stock-token prices may rise or fall. Defensive, Balanced, and Aggressive are relative risk categories, not guarantees.

### 18.2 Relative Performance Risk

The basket may underperform the originally deposited stock. A user who deposits NVDA may later receive fewer NVDA tokens when redeeming into NVDA.

### 18.3 Liquidity Risk

Some stock tokens may have insufficient liquidity, causing higher slippage or delayed execution.

### 18.4 Smart-Contract Risk

Vault, router, oracle, and receipt-token contracts may contain defects.

### 18.5 Oracle Risk

Incorrect or delayed prices may affect valuation and execution safeguards.

### 18.6 Tokenized-Asset Risk

Tokenized stocks may depend on issuers, custodians, market hours, redemption rules, and jurisdictional restrictions.

### 18.7 Network Risk

Transactions may fail, become delayed, or cost more during network congestion.

### 18.8 Cashback Availability

Cashback is limited by Novex's funded reward inventory. It is not unlimited and should not be promised when the required stock tokens are unavailable.

---

## 19. MVP Scope

The MVP should prove the core product with the fewest possible moving parts.

### 19.1 Included

- Wallet connection.
- A limited set of approved deposit assets.
- Defensive, Balanced, and Aggressive strategies.
- Preferred-stock selection.
- Basket preview.
- Onchain deposit.
- Basket creation through approved swaps.
- Receipt-token minting.
- Deposit Stockback.
- Allocation Stockback.
- Portfolio dashboard.
- Current NAV and performance.
- Redemption preview.
- Receipt-token burning.
- Redemption into the original deposit asset or proportional basket.
- Public vault transparency.

### 19.2 Excluded

- Sponsored stock campaigns.
- Creator campaigns.
- Public campaign marketplace.
- Swap-and-bridge activity hub.
- Token launchpad.
- Cross-chain deposits.
- Guaranteed principal.
- Guaranteed original stock quantity.
- Options or leveraged products.
- Governance token.
- Referral rewards.
- Social trading.
- Copy portfolios.

---

## 20. Suggested MVP Asset Policy

The first version should support a small number of highly liquid assets rather than a large catalog.

An asset should only be added after evaluating:

- Contract authenticity.
- Issuer and backing model.
- Onchain liquidity.
- Reliable pricing.
- Market availability.
- Transfer restrictions.
- Redemption restrictions.
- Oracle support.
- Regulatory availability.

The exact initial assets must be verified against the target chain and available tokenized-stock infrastructure before implementation.

---

## 21. Product Interface

## 21.1 Home

Primary message:

> Deposit one stock. Receive a managed basket.

Supporting message:

> Choose your strategy and preferred companies, receive stock-token cashback, and keep 100% of your portfolio's investment performance.

Primary action:

```text
Create a Basket
```

Secondary action:

```text
Explore Strategies
```

## 21.2 Create Basket

Sections:

1. Deposit stock.
2. Deposit amount.
3. Strategy selection.
4. Preferred stocks.
5. Excluded stocks.
6. Proposed allocation.
7. Cashback preview.
8. External cost estimate.
9. Final confirmation.

## 21.3 Portfolio

Primary metrics:

```text
Current value
Net investment performance
Total Stockback
Receipt-token balance
Current strategy
```

Charts:

- Portfolio value over time.
- Allocation by asset.
- Performance contribution by asset.
- Cashback history.

## 21.4 Activity Ledger

Every financial operation should have:

```text
Type
Date
Transaction hash
Assets
Value
Receipt tokens
Cashback
Status
```

## 21.5 Redeem

The redemption screen should allow:

- Original deposit asset.
- Supported stable asset, if enabled.
- Underlying basket.

It must show estimates before wallet confirmation.

---

## 22. Example Complete Position

### Initial Deposit

```text
Deposit: $500 NVDA
Strategy: Balanced
Preferred: Apple, Microsoft, SanDisk
```

### Proposed Allocation

```text
NVDA        $100
Apple       $125
Microsoft   $125
SanDisk      $75
SPY          $75
----------------
Total       $500
```

### Cashback

```text
Deposit Stockback:                 $2.000

Apple allocation:
$125 × 1.00%                       $1.250

Microsoft allocation:
$125 × 0.50%                       $0.625

SanDisk allocation:
$75 × 1.00%                        $0.750

Total Allocation Stockback:        $2.625
Total Stockback:                   $4.625
```

### Opening Position

```text
Deposit value:                    $500.000
Total Stockback:                   +$4.625
Estimated external costs:          -$0.800
Estimated opening net value:      $503.825
```

### Later Performance

```text
Opening net value:                $503.825
Basket investment performance:    +$46.175
Current position value:           $550.000
Novex fee:                          $0.000
```

### Redemption Into NVDA

If NVDA is $500:

```text
$550 ÷ $500 = 1.10 NVDA before external costs
```

If NVDA is $650:

```text
$550 ÷ $650 = 0.846 NVDA before external costs
```

In both cases, the user receives the full current value of the managed position.

---

## 23. Trust Principles

Novex should follow these principles:

1. User assets remain in restricted smart-contract vaults.
2. Receipt-token ownership is verifiable onchain.
3. Critical allocation limits are enforced by contracts.
4. Cashback calculations are published before confirmation.
5. Historical calculations are not changed retroactively.
6. Investment returns and cashback are reported separately.
7. Novex platform fees are shown as zero.
8. External costs are shown honestly.
9. No guaranteed profit is advertised.
10. No guaranteed original stock quantity is advertised.
11. Redemptions return current proportional value.
12. Cashback stops when the funded inventory is exhausted.

---

## 24. Key Open Decisions

The following decisions must be completed before production development:

1. Final product and token naming.
2. Target blockchain and stock-token standards.
3. Approved initial stock-token issuers.
4. Available liquidity routes.
5. Price-oracle design.
6. Shared strategy vaults versus personalized vault accounting.
7. Transferability of receipt tokens.
8. Initial Deposit Stockback amount.
9. Allocation Stockback rates.
10. Maximum rewarded deposit.
11. Cashback reserve size.
12. Rebalance frequency.
13. Redemption assets.
14. Stable-reserve policy.
15. Jurisdiction and user-eligibility rules.
16. Long-term fee-free business and reward-funding model.

---

## 25. Recommended Development Phases

### Phase 1: Product and Market Validation

- Confirm target users.
- Validate demand for single-stock diversification.
- Verify available stock tokens.
- Verify liquidity and redemption behavior.
- Test strategy and cashback messaging.
- Finalize receipt-token semantics.

### Phase 2: Technical Prototype

- Implement simulated Defensive, Balanced, and Aggressive allocations.
- Implement basket preview.
- Implement NAV accounting.
- Implement Deposit and Allocation Stockback calculations.
- Simulate receipt-token minting and redemption.
- Test relative performance against the original deposit stock.

### Phase 3: Smart-Contract Testnet

- Deploy restricted vault contracts.
- Add deposit and receipt-token minting.
- Add allocation execution.
- Add cashback reserve.
- Add redemption.
- Add emergency controls.
- Test oracle and liquidity failures.

### Phase 4: Security

- Complete unit and invariant testing.
- Test share-accounting edge cases.
- Test rounding behavior.
- Test oracle manipulation resistance.
- Test slippage controls.
- Test reward-budget exhaustion.
- Complete independent contract review and audit.

### Phase 5: Limited Launch

- Support a small approved asset set.
- Apply deposit and vault caps.
- Limit cashback budget.
- Monitor every rebalance and redemption.
- Publish contract addresses and risk disclosures.

### Phase 6: Expansion

- Add supported stock tokens gradually.
- Improve personalization.
- Add additional redemption assets.
- Evaluate additional basket types.
- Consider campaigns only after the core vault product is stable.

---

## 26. Success Metrics

Initial product metrics should include:

- Total value deposited.
- Active managed positions.
- Average deposit size.
- Deposit-to-confirmation conversion.
- Redemption rate.
- Average holding period.
- Total Deposit Stockback distributed.
- Total Allocation Stockback distributed.
- Cashback cost per activated user.
- External execution cost as a percentage of deposit.
- Basket performance relative to selected benchmarks.
- Basket performance relative to the original deposit stock.
- Rebalance success and failure rates.
- Receipt-token accounting accuracy.

Success should not be measured only by total value deposited. User understanding, successful redemptions, and accurate accounting are essential.

---

## 27. Final Product Definition

Novex is a fee-free, onchain managed-stock protocol.

Users deposit a supported tokenized stock, choose a risk strategy and preferred companies, and receive a diversified basket held in a smart-contract vault. The protocol mints a receipt token representing proportional ownership of the basket.

Novex adds value through two clearly defined cashback layers:

1. **Deposit Stockback:** a fixed Novex-funded stock-token bonus for an eligible deposit.
2. **Allocation Stockback:** a percentage-based bonus in an eligible stock token when the basket purchases that stock.

All basket investment performance belongs to the user. Novex charges no deposit, management, performance, or platform redemption fee in the proposed version. External market and network costs remain visible.

When users redeem, they receive the current proportional value of their basket. They may receive that value in the original deposit asset, a supported stable asset, or the underlying basket, depending on available redemption options.

Novex does not guarantee the original quantity of the deposited stock and does not guarantee a profit. Its core promise is simpler:

> Deposit one stock, receive a managed basket and real stock-token cashback, and keep 100% of your portfolio's investment performance.
