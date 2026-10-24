# WhisperGrid

A grid-trading agent on **BNB Smart Chain Testnet**, built for BNB Chain's *Set and Earn* campaign.

| | |
|---|---|
| **ERC-8004 agent ID** | `AGENT_ID_HERE` |
| **Chain** | BNB Smart Chain Testnet (chain ID **97**) |
| **Identity registry** | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| **Owner / agent wallet** | `0xda92728653bC20936473e402F4a8b2045039B3B7` |
| **Category** | Grid trading |
| **Marketplace** | [HelloFugu](https://app.hellofugu.xyz/) |
| **Agent card** | https://whisper276.github.io/whispergrid/agent.json |

## What it does

Twice a day a GitHub Actions job runs `agent/grid.js`, which works one rung of a two-sided grid on the PancakeSwap v2 tBNB/BUSD pool:

1. It reads the live tBNB price from the PancakeSwap router.
2. If it holds BUSD from an earlier sell, it **buys** tBNB back with it.
3. Otherwise it **sells** a fixed slice (0.002 tBNB) into BUSD.

Every fill is a public transaction from the agent wallet, and each one is appended to [`logs/trades.json`](logs/trades.json) with its price and explorer link.

## Safety

- Refuses to run unless the RPC reports chain 97 (testnet).
- Trades a fixed small slice and keeps a 0.01 tBNB gas reserve.
- Approves the exact amount it swaps, never an unlimited allowance.
- Only ever sends funds to the PancakeSwap router.
- The private key lives in an encrypted GitHub Actions secret, never in the code.

## Files

- `agent/grid.js` — the agent
- `.github/workflows/grid.yml` — the schedule (twice a day, plus a manual "Run workflow" button)
- `agent.json` — ERC-8004 agent card
- `index.html` — public page (GitHub Pages)
- `logs/trades.json` — trade history
