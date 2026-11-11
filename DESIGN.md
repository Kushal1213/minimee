# Design — Minimi Research Agent

**Author:** [Kushal](https://github.com/Kushal1213)

## How it works

One explicit orchestrator owns every turn: classify the request, resolve relative time using the user's IANA timezone, retrieve memory when needed, plan at most six searches, compare historical claims with current evidence, synthesize an answer, validate its citations, then persist the turn. Independent searches run concurrently, so checking five shortlisted products costs search breadth but not five sequential network round trips. The only external agent tool is Tavily `web_search`; OpenRouter is the reasoning model, not a hidden tool layer.

SQLite is the system of record. Original messages are immutable evidence. FTS5 supports topic recall; UTC timestamp ranges support exact local-day recall; ±1 neighboring turns preserve question/answer pairs. Entities, facts, and daily summaries are derived indexes with message provenance, never replacements for the transcript. The current prompt is written only after retrieval so it cannot retrieve itself as “memory.” A clock dependency makes relative dates deterministic in tests while production uses real time.

Search results form an evidence ledger: URL, title, snippet, publication date, and provider score. Results are normalized, deduplicated, and ranked toward HTTPS pricing, changelog, release, and news pages. Search text is treated as untrusted data and prompt-like instructions are filtered. Deterministic comparison produces `NEW`, `CHANGED`, `UNCHANGED`, `DISCONTINUED`, or `UNKNOWN`. No result, failed search, or incompatible billing context always yields `UNKNOWN`. After streaming, code removes citation IDs that were not returned by search and sends a final replacement event if correction was necessary.

## Why this architecture

The challenge's hardest cases combine episodic memory, calendar reasoning, and changing facts. A generic chat history window fails after restart and cannot answer “3 November” across conversations. A free-form ReAct loop is flexible but makes latency, tool budgets, and failure behavior unpredictable. This staged pipeline keeps the model useful where language judgment matters while enforcing truthfulness, provenance, and limits in code.

The architecture also degrades honestly. With no OpenRouter key, deterministic recall and evidence summaries still work. With no Tavily key, the agent says verification did not happen. Malformed model JSON falls back to heuristic planning. Raw messages survive every derived-index failure.

## Considered and rejected

| Alternative | Why not here |
|---|---|
| LangGraph / multi-agent roles | One tool does not justify graph state or handoff failure modes. |
| Vector database | Extra service, cost, and embedding lag; FTS5 plus exact dates is stronger for the test shape. |
| Put all history in the prompt | Slow, expensive, non-durable, and prone to blending unrelated conversations. |
| Let the model decide whether evidence proves “unchanged” | Absence-of-evidence errors are too costly; conservative rules enforce `UNKNOWN`. |
| Fully deterministic answering | Reliable but brittle and unpleasant to talk to; the LLM remains the presentation and language-reasoning layer. |

## Trade-offs and another week

Lexical recall can miss deep paraphrases, snippet-level evidence can omit plan context, and product-name extraction is intentionally conservative. With another week I would add hybrid embeddings as a secondary retriever, fetch and quote official pages after discovery, learn canonical vendor/plan identities, add per-claim source diversity and freshness scores, and build a recorded live-search evaluation set measuring recall, citation precision, latency, and change-classification calibration. For multi-user deployment I would add authentication and tenant keys before any shared hosting.
