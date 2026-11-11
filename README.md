# Minimi Research Agent

A memory-aware chat agent built for the Minimi hiring challenge by [Kushal](https://github.com/Kushal1213). It remembers original conversations, interprets dates in the user's timezone, searches the live web, and compares old claims with current evidence.

## Why it is different

The hard part is not adding a search box to a chatbot. It is answering questions such as “what did I ask last Tuesday, and is it still true?” without blending the old answer, current evidence, and the model's guesses.

Minimi therefore keeps three layers separate:

- **Memory:** immutable user and assistant messages in SQLite, with FTS5 and timezone-aware date retrieval.
- **Evidence:** results returned by the single `web_search` tool. Search snippets are untrusted input and every source keeps its URL and date.
- **Judgment:** deterministic comparison rules plus LLM synthesis. Missing evidence is `UNKNOWN`, never “unchanged.”

Independent searches run concurrently within a strict tool budget. A final code-level guard removes citation markers that do not correspond to a real search result.

## Architecture

```text
React client  ←── SSE ──  Express API
                            │
                     Agent orchestrator
                   plan → recall → research
                      → compare → answer
                    ╱          │          ╲
           SQLite + FTS5   web_search    OpenRouter
             source of       Tavily       planning /
               truth                      synthesis
```

See [`DESIGN.md`](./DESIGN.md) for the decisions and trade-offs.

## Run locally

Requirements: Node.js 22+ and npm.

```bash
npm install
cp .env.example .env
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The API runs on port 3001.

The app starts without API keys so its memory and fallback behavior can be inspected. Live research and full conversational synthesis require:

| Variable | Required for | Default |
|---|---|---|
| `OPENROUTER_API_KEY` | planning, extraction, answer synthesis | — |
| `TAVILY_API_KEY` | live `web_search` | — |
| `MODEL_NAME` | OpenRouter model | `openai/gpt-5-mini` |
| `DATABASE_PATH` | persistent SQLite file | `./data/minimi.db` |
| `DEFAULT_TIMEZONE` | server fallback timezone | `Asia/Kolkata` |

Every supported variable is documented in `.env.example`.

## Verify

```bash
npm test
npm run typecheck
npm run build
```

The tests cover the challenge scenarios, restart-safe memory, FTS retrieval, timezone boundaries, bounded tool use, failed search behavior, citation validation, comparison semantics, and SSE transport.

## Project map

```text
server/agent/       orchestration and deterministic comparison
server/memory/      SQLite memory, retrieval, temporal parsing
server/tools/       the sole external tool: web_search
server/llm/         provider adapter with retries and streaming
src/                React chat UI
tests/              unit, integration, and scenario tests
```

Built by [Kushal](https://github.com/Kushal1213).
