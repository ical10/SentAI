# SentAI - Recurrent, Verifiable AI Orchestration Layer Built with CRE, xAI, and Polymarket

## Overview

SentAI is built during **Convergence | A Chainlink Hackathon 2026** on top of:

- Chainlink Runtime Environment,
- xAI API,
- Polymarket Gamma API.

for **CRE & AI** track.

It is an on-chain end-to-end automated process called "workflow" to generate Polymarket market decisions based on X posts analysis and then publish them on-chain. Successfully generated market decisions can be verified on a smart contract deployed on Sepolia.

## Problems and How SentAI Solves Them

Prediction markets has been gaining a huge traction lately, and one of the biggest platform out there is Polymarket, with a trading volume of up to $24.6B for the past three years only (see [TokenTerminal data](https://tokenterminal.com/explorer/projects/polymarket/metrics/trading-volume)). Polymarket is also very popular among many crypto traders, where there are 4151 crypto-related bets as the time of writing. Based on some research (e.g. [this one](https://link.springer.com/article/10.1007/s11147-025-09223-6#:~:text=Furthermore%2C%20while%20Anamika%20and%20Subramaniam,items%2C%20which%20are%20aggregated%20daily.)), news and social media posts might reflect market sentiments and are significantly associated with price movements.

Where is the biggest platform where crypto is very popular? The answer is X. There you can find hundreds of recently popular posts from crypto influencers and news media 24/7. However, it is very time-consuming to read each of these X posts, analyse them, and draw a conclusion for a very simple bet question ("will BTC be higher than $79,000 in 5m?"). Comes AI into the picture to solve this issue, and X actually provides their own AI model that has real-time access to the data on the X platform, called xAI or Grok. With xAI, you can ask it a prediction market question and it will seamlessly provides you with synthesis from the most recent, trending and related X posts.

Then how do we verify if the AI is not lying to us? Or if the market bets we got are actually manipulated? After all, all of these services are hosted on centralized servers. For this, we need to provide a tamper-proof, verifiable, recurrent solution, and the best technical solution for that is by leveraging workflow built on top of Chainlink Runtime Environment (CRE). With CRE, we can make sure that all of the related services are deterministic and verifiable, and the workflow results can be submitted directly on-chain. It simply eliminates the issue about trusts as we are able to provide an end-to-end verifiable solution for those problems. SentAI helps you to provide that effortlessly, and it is easily modifiable; you can plug other AI or change the workflow config to suit your needs.

## Hacky Parts / Interesting Workarounds

This section lists some of interesting hacks and workarounds needed in order to fulfill the necessary requirements and provide the best results for the workflow, in no particular order.

### Best Estimate on Consensus-Safe Market Creation Price Using Modified Binary Search

- **Phase-aware binary search for historical Chainlink prices** (in `data.ts`): Chainlink roundIds encode `phaseId` in upper bits (`roundId = (phaseId << 64) | aggregatorRoundId`). This is important to note for implementing binary search in `findRoundAtTimestamp` to stay within the current phase to avoid reverts on invalid roundIds. The binary search also estimates a lower bound from time difference to narrow the search range, and caps iterations to 5 to avoid chain read limit. With this approach, we get the best estimate of market creation price that is consensus-safe because it is provided by Chainlink Price Feed, not by some centralized APIs.

### Trusted/Untrusted Data Separation to Avoid Prompt Injection

- **Trusted/untrusted data separation in Grok prompts** (in `grok.ts`): Market questions from Polymarket are treated as untrusted input (prompt injection risk) and fenced with `---BEGIN/END UNTRUSTED MARKET DATA---` delimiters. Chainlink prices and market metadata are passed separately as trusted data. The system prompt explicitly instructs Grok to ignore any instructions embedded in market questions, making it more secure.

### Array Response for Per-Crypto Token Decisions

- **Single Grok call returns array of decisions** (`grok.ts`, `main.ts`): Instead of calling Grok once per token, we ask for one decision per token in a single request and get back a JSON array. Saves runtime costs (one API call instead of N) but it means all tokens share the same X Search context and prompt, and a failure in one token's analysis could affect the whole batch.

### Dual Schema Maintenance

- **Manual JSON Schema mirrors identically Zod schema** (in `grok.ts`): `zodToJsonSchema` doesn't work in the CRE WASM runtime, so the JSON Schema for Grok's structured output is hand-written (`grokDecisionJsonSchema`). If `GrokDecisionSchema` in `types.ts` changes, this must be updated manually. More work but no compile-time sync check.

### Runtime Access when Fetching Active Markets

- **`nowInMs` passed down instead of using `runtime` directly** (in `data.ts`): The `FetchMarkets` callback signature doesn't have access to `runtime`, so we extract `runtime.now().getTime()` in `fetchActiveMarkets` and pass it as a closure variable.

## Future Improvements (Post-Submission)

### logTrigger-Based Expansions

1. **Event-Driven Price Feed Trigger** — Use `logTrigger` to watch `AnswerUpdated` events on Chainlink price feed proxies (Sepolia). Instead of fixed 15-min cron intervals, the workflow reacts to actual price movements. This makes SentAI event-driven rather than time-driven.

2. **Whale Watcher (Polymarket CTF)** — Polymarket's CLOB trades are off-chain, but the CTF (Conditional Token Framework) on Polygon emits `TransferSingle`/`TransferBatch` (ERC-1155) events when outcome tokens move. A second workflow could watch for large transfers (>$50k), map token IDs to market slugs, and trigger Grok analysis ("Whale bought $200k YES on BTC-15m-up — confirm or fade?"). Further research is needed to verify if CRE supports Polygon as a trigger chain.

3. **Self-Chaining Decisions** — Use `logTrigger` on our own `SentAILogger` contract to create chain-reaction workflows. E.g., a second workflow watches `SentAIDecision` events and escalates size with a predetermined parameters, e.g. if the last 3 decisions were all `BET_YES` with confidence > 80.

### Other Improvements

4. **The Graph Subgraph** — Index `SentAIDecision` events for instant querying by the frontend
5. **Gasless Orders** — Use Polymarket relayer for gasless CLOB order submission
6. **Multi-Asset Portfolio Rebalancing** — Expand beyond single-market decisions to portfolio-level allocation

## Disclaimer

This project involves AI assistance in some parts, especially during the ideation process and workflow design, but most of the code (>90%) is hand-written and carefully checked by human. It is not yet audited and battle-tested, so use it **at your own risks**.

## References

- [Polymarket Gasless Transactions](https://docs.polymarket.com/trading/gasless)
