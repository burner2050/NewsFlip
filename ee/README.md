# NewsFlip Enterprise Edition (`ee/`)

> ⚠️ **Different license.** Everything in this `ee/` directory is **commercial /
> proprietary** software, *not* AGPL-3.0. See [`ee/LICENSE`](./LICENSE).
> The rest of the repository (the open-source core) is licensed under AGPL-3.0
> (see the top-level [`LICENSE`](../LICENSE)).

This is the **open-core** boundary. The community core in `src/` is fully
functional on its own. Premium ("Pro" / "Enterprise") features live here and are
activated at runtime only when a valid license key is present
(`NEWSFLIP_LICENSE_KEY`), via the gate in
[`src/license/license.ts`](../src/license/license.ts).

## Rules of the boundary
- **Core never imports `ee/`.** Core calls premium behavior through the license
  gate / pluggable interfaces (e.g. `Embedder`, `FactExtractor`, `Summarizer` in
  `src/ai/types.ts`). The app builds and runs with this directory absent.
- **`ee/` may import core**, not the other way around.
- Premium provider implementations register themselves behind the same
  interfaces, so swapping community stubs for licensed implementations needs no
  call-site changes.

## Planned premium features
| Feature | Gate flag | Notes |
|---|---|---|
| LLM story summaries | `llm-summaries` | Hosted Claude/OpenAI summarization with caching |
| Fact extraction | `fact-extraction` | Structured claims + entity linking |
| Semantic clustering | `semantic-clustering` | Managed embeddings + online story clustering over pgvector |
| Alert delivery | `alert-delivery` | Webhook / email / Slack dispatch with rate limiting |

## Layout (when populated)
```
ee/
  LICENSE          commercial license
  README.md        this file
  src/             premium implementations of core interfaces
```
