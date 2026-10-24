// WhisperGrid — a small grid-trading agent for BNB Smart Chain Testnet (chain 97).
//
// Each run (triggered by GitHub Actions on a schedule):
//   1. Reads the live tBNB price in the quote token from PancakeSwap.
//   2. Works one rung of a two-sided grid:
//        - if it holds quote tokens from an earlier sell, it BUYS tBNB back with them;
//        - otherwise it SELLS one fixed slice of tBNB into the quote token.
//      Selling high and buying back on the next rung is the grid; the price at
//      every fill is logged so the result can be checked against the chain.
//   3. Appends the trade to logs/trades.json (committed back by the workflow).
//
// Safety: it only ever talks to the testnet RPC, trades a fixed small slice,
// keeps a gas reserve, and never sends funds anywhere except the DEX router.

import { ethers } from "ethers";
import fs from "node:fs";

const RPC = process.env.RPC_URL || "https://data-seed-prebsc-1-s1.bnbchain.org:8545";
const CHAIN_ID = 97n;

// PancakeSwap v2 on BSC Testnet
const ROUTER = "0xD99D1c33F9fC3444f8101754aBC46c52416550D1";
const WBNB = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd";
// Quote token (testnet BUSD by default). Override with QUOTE_TOKEN if this pool runs dry.
const QUOTE = process.env.QUOTE_TOKEN || "0x78867BbEeF44f2326bF8DDd1941a4439382EF2A7";

const SLICE_BNB = process.env.SLICE_BNB || "0.002";   // tBNB sold per grid rung
const GAS_RESERVE_BNB = "0.01";                        // never trade below this
const SLIPPAGE_BPS = 300n;                             // 3% (testnet pools are thin)

const ROUTER_ABI = [
  "function getAmountsOut(uint amountIn, address[] path) view returns (uint[] amounts)",
  "function swapExactETHForTokens(uint amountOutMin, address[] path, address to, uint deadline) payable returns (uint[] amounts)",
  "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline) returns (uint[] amounts)",
];
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint)",
  "function allowance(address owner, address spender) view returns (uint)",
  "function approve(address spender, uint amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

function minOut(amount) {
  return (amount * (10000n - SLIPPAGE_BPS)) / 10000n;
}

function appendLog(entry) {
  const file = "logs/trades.json";
  fs.mkdirSync("logs", { recursive: true });
  const all = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
  all.push(entry);
  fs.writeFileSync(file, JSON.stringify(all, null, 2) + "\n");
}

async function main() {
  const key = process.env.AGENT_PRIVATE_KEY;
  if (!key) throw new Error("AGENT_PRIVATE_KEY secret is missing.");

  const provider = new ethers.JsonRpcProvider(RPC);
  const net = await provider.getNetwork();
  if (net.chainId !== CHAIN_ID) throw new Error(`Refusing to run: RPC is chain ${net.chainId}, not testnet 97.`);

  const wallet = new ethers.Wallet(key, provider);
  const router = new ethers.Contract(ROUTER, ROUTER_ABI, wallet);
  const quote = new ethers.Contract(QUOTE, ERC20_ABI, wallet);
  const [symbol, decimals] = await Promise.all([quote.symbol(), quote.decimals()]);

  const one = ethers.parseEther("1");
  const priceRaw = (await router.getAmountsOut(one, [WBNB, QUOTE]))[1];
  const price = Number(ethers.formatUnits(priceRaw, decimals));

  const bnbBal = await provider.getBalance(wallet.address);
  const quoteBal = await quote.balanceOf(wallet.address);
  console.log(`Agent ${wallet.address}`);
  console.log(`Price 1 tBNB = ${price} ${symbol} | balance ${ethers.formatEther(bnbBal)} tBNB, ${ethers.formatUnits(quoteBal, decimals)} ${symbol}`);

  const deadline = Math.floor(Date.now() / 1000) + 600;
  const dust = ethers.parseUnits("0.01", decimals);
  let side, tx, amountIn;

  if (quoteBal > dust) {
    // BUY rung: spend the quote tokens from the last sell to buy tBNB back.
    side = "BUY";
    amountIn = quoteBal;
    const allowance = await quote.allowance(wallet.address, ROUTER);
    if (allowance < amountIn) {
      const a = await quote.approve(ROUTER, amountIn); // exact amount, never unlimited
      await a.wait();
      console.log(`Approved ${ethers.formatUnits(amountIn, decimals)} ${symbol}: ${a.hash}`);
    }
    const expected = (await router.getAmountsOut(amountIn, [QUOTE, WBNB]))[1];
    tx = await router.swapExactTokensForETH(amountIn, minOut(expected), [QUOTE, WBNB], wallet.address, deadline);
  } else {
    // SELL rung: sell one fixed slice of tBNB into the quote token.
    side = "SELL";
    amountIn = ethers.parseEther(SLICE_BNB);
    if (bnbBal < amountIn + ethers.parseEther(GAS_RESERVE_BNB)) {
      throw new Error("Not enough tBNB. Top the agent wallet up from the faucet.");
    }
    const expected = (await router.getAmountsOut(amountIn, [WBNB, QUOTE]))[1];
    tx = await router.swapExactETHForTokens(minOut(expected), [WBNB, QUOTE], wallet.address, deadline, { value: amountIn });
  }

  const receipt = await tx.wait();
  if (receipt.status !== 1) throw new Error(`Swap reverted: ${tx.hash}`);

  const entry = {
    time: new Date().toISOString(),
    side,
    price,
    quote: symbol,
    amountIn: side === "SELL" ? `${SLICE_BNB} tBNB` : `${ethers.formatUnits(amountIn, decimals)} ${symbol}`,
    tx: tx.hash,
    explorer: `https://testnet.bscscan.com/tx/${tx.hash}`,
  };
  appendLog(entry);
  console.log(`${side} done: ${entry.explorer}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
