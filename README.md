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
