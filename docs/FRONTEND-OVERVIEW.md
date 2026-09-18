# Compose — the frontend, in plain words

A short tour of the website. No backend, no smart contracts — just what a
visitor sees and what the app does when they click.

## What the product is

Compose is a website where people buy tokenized stocks on Robinhood Chain.
Three things you can do:

1. **Baskets** — put in one stock, get a spread of many stocks back, chosen by
   a strategy you pick. You hold a *receipt token* that tracks what the basket
   is worth.
2. **Launchpad** — anyone can launch a token made of two stocks, and anyone can
   trade it.
3. **Markets** — browse stocks, ETFs and forex with live prices and charts.

## The pages

| Page | What happens there |
| --- | --- |
| `/` | Landing page. What Compose is, live numbers, FAQ. |
| `/markets` | Search stocks/ETFs/forex, see prices, keep a watchlist. |
| `/markets/[ticker]` | One stock: chart, stats, trade panel. |
| `/create` | Build a basket: pick a stock, an amount, a strategy → deposit. |
| `/vault/[id]` | A strategy vault: what it holds, and a deposit button. |
| `/launch` | Step-by-step wizard to launch your own two-stock token. |
| `/launchpad` | All launched tokens, with filters and sorting. |
| `/token/[address]` | One launched token: chart and buy/sell. |
| `/pair/[address]` | One launched pair: chart, buy/sell, creator rewards. |
| `/portfolio` | Your holdings and their total value. Needs a wallet. |
| `/activity` | Your history: buys, sells, deposits, redeems, rewards. |
| `/redeem` | Turn a basket receipt back into stock, the basket, or USDG. |
| `/docs`, `/legal/*` | Documentation, terms, privacy, risk. |

## How someone uses it

**Connect a wallet.** Login is handled by Privy. Until then, pages like
Portfolio just ask you to connect.

**Buy or sell.** Every trade panel works the same way:

1. You pick buy or sell, what to pay with (ETH, USDG, or stocks you hold),
   and an amount.
2. The app shows a live quote — what you'll get, and the price impact.
3. You press the button, your wallet pops up, you sign. Done.

**Create a basket.** Pick a stock, an amount and a strategy (defensive,
balanced or aggressive). The app finds the right vault, shows a cost preview,
then asks your wallet for two signatures: one to approve spending, one to
deposit.

**Launch a token.** Pick two stocks and their weights, choose how much to seed
it with, add a name and image, then launch. The picture and name are saved off
-chain; the token itself is created on-chain.

**Creator rewards.** If you launched a pair, its page shows the fees you've
earned and lets you claim them as ETH, USDG or the underlying stocks.

## Where the numbers come from

Three sources, which is the one thing worth remembering:

- **The blockchain itself** — balances, prices and quotes are read straight
  from the contracts, so they're always current.
- **Compose's own servers** — history, charts, portfolio totals and the list of
  launched tokens. Reading every past event from the chain would be too slow,
  so a server keeps an index of it. Some pages also stream live updates from
  it.
- **Outside price APIs** — regular stock prices come from Yahoo Finance, and
  some trading charts from DexScreener, both through the site's own small proxy
  routes.

If Compose's server is down, prices and trading still work; history and
portfolio pages are the ones that go quiet.

## How it's built

- **Next.js 15 and React** — the pages.
- **Tailwind CSS with Radix UI** — the styling and common pieces (dialogs,
  tabs, tooltips). Light and dark themes.
- **Privy, wagmi, viem** — wallet login and everything blockchain.
- **TanStack Query** — fetches data and keeps it fresh and cached.
- **Motion and GSAP** — the animations on the landing page.
- Charts and sparklines are written in-house, not a chart library.

## Two details that come up

- **Logos.** Stock logos load from a public logo CDN. If a ticker has none, the
  app shows a neat text badge instead and won't ask again. ETH and USDG use
  their own marks with a small green Robinhood Chain badge.
- **Testnet vs mainnet.** The app reads which network it's on and swaps in that
  network's contract addresses. If a feature has no address set for that
  network — baskets, for example — the app hides or disables it rather than
  breaking. That's why the Vaults link isn't always in the menu.
