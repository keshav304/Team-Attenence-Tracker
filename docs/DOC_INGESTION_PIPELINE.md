# Documentation Ingestion Pipeline — Architecture Guide

> **Purpose:** Automatically keep the RAG-powered chat assistant in sync whenever
> product documentation is added or modified. This document describes the high-level
> architecture, design decisions, and the recommended approach for connecting a
> separate ingestion pipeline repository to the main A-Team-Tracker application.

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Pipeline Overview (3 Stages)](#2-pipeline-overview-3-stages)
   - [Stage 1 — Detect Changes (Trigger)](#stage-1--detect-changes-trigger)
   - [Stage 2 — Chunk & Embed (Processing)](#stage-2--chunk--embed-processing)
   - [Stage 3 — Upsert to Vector DB (Storage)](#stage-3--upsert-to-vector-db-storage)
3. [End-to-End Flow](#3-end-to-end-flow)
4. [Separate Repository Strategy](#4-separate-repository-strategy)
   - [Option 1 — Repository Dispatch (Recommended)](#option-1--repository-dispatch-recommended)
   - [Option 2 — Git Submodule](#option-2--git-submodule)
   - [Option 3 — Shared MongoDB, No Git Link](#option-3--shared-mongodb-no-git-link)
5. [Contract Between Repos](#5-contract-between-repos)
6. [Key Design Decisions](#6-key-design-decisions)
7. [Optional Enhancements](#7-optional-enhancements)

---

## 1. Problem Statement

The A-Team-Tracker application includes a RAG (Retrieval-Augmented Generation) chat
assistant. It works as follows:

1. User asks a question via the chat interface.
2. The question is embedded using `Xenova/all-MiniLM-L6-v2` (384-dim vectors).
3. MongoDB Atlas Vector Search retrieves the most relevant chunks from the
   `product_docs` collection in the `dhsync` database.
4. An LLM generates an answer grounded on those chunks.

**The problem:** When a feature is added or modified, the documentation
(`PRODUCT_DOCUMENTATION.md`) must be manually updated, re-chunked, re-embedded,
and upserted into the vector database. Until that happens, the chat assistant
returns stale or incomplete answers.

**The goal:** Automate this entire flow so that merging a documentation change
triggers re-ingestion automatically.

---

## 2. Pipeline Overview (3 Stages)

### Stage 1 — Detect Changes (Trigger)

| Approach | Description | Best For |
|---|---|---|
| **GitHub Actions (CI)** | A workflow triggers on pushes to `main` when `.md` files change. Uses a `paths` filter. Calls a script or dispatches an event to the pipeline repo. | Production (recommended) |
| **File Watcher (`chokidar`)** | A process in the server monitors `.md` files and triggers re-embedding on save. | Local development only |
| **Admin API Endpoint** | Expose `POST /api/admin/reindex-docs` (admin-only) that can be called manually or from CI. | Manual fallback; pairs well with CI |

**Recommendation:** Use GitHub Actions as the primary trigger, with an admin
endpoint as a manual fallback.

### Stage 2 — Chunk & Embed (Processing)

```
┌──────────────┐     ┌──────────────┐     ┌──────────────────┐
│  Read .md    │────▶│  Chunk by    │────▶│  Embed each      │
│  file(s)     │     │  section /   │     │  chunk via       │
│              │     │  heading     │     │  embedText()     │
│              │     │              │     │  (MiniLM-L6-v2)  │
└──────────────┘     └──────────────┘     └──────────────────┘
```

**Chunking strategy:**

- Parse the markdown by `##` headings. Each heading becomes a chunk boundary.
- Attach metadata to each chunk:
  ```json
  {
    "source": "PRODUCT_DOCUMENTATION.md",
    "page": 4,
    "heading": "## 4. Editing Rules"
  }
  ```
- For long sections, apply a **sliding window** (e.g. 500 tokens with 100-token
  overlap) to keep chunks within the embedding model's context window.
- Reuse the existing `embedText()` utility which uses `Xenova/all-MiniLM-L6-v2`
  and produces 384-dimensional vectors.

**Diff-aware optimisation (optional):**

- Hash each chunk's text content (SHA-256).
- Before upserting, compare hashes against stored hashes in the database.
- Only re-embed chunks whose content actually changed — saves compute.

### Stage 3 — Upsert to Vector DB (Storage)

```
┌──────────────────┐     ┌─────────────────────────────┐
│  Embedded chunks │────▶│  MongoDB Atlas               │
│  with vectors    │     │  DB: dhsync                  │
│                  │     │  Collection: product_docs    │
│                  │     │  Index: vector_index         │
│                  │     │                               │
│                  │     │  Strategy: upsert by chunk ID │
└──────────────────┘     └─────────────────────────────┘
```

**Upsert strategy:**

- Assign each chunk a deterministic `_id` based on
  `source + sectionHeading + chunkIndex`.
- Use MongoDB `bulkWrite` with `updateOne` + `upsert: true` for each chunk.
- After upserting, delete any orphaned chunks (sections that were removed from
  the documentation).
- The Atlas `vector_index` auto-updates in near real-time after writes.

---

## 3. End-to-End Flow

```
Developer merges PR with documentation changes
        │
        ▼
GitHub Actions detects PRODUCT_DOCUMENTATION.md changed
        │
        ▼
Dispatches event to pipeline repo (or runs script directly)
        │
        ▼
Pipeline reads .md files → chunks by heading → embedText() each
        │
        ▼
bulkWrite upserts to MongoDB `dhsync.product_docs` collection
        │
        ▼
Atlas vector_index auto-updates (near real-time)
        │
        ▼
Next chat query via searchDocs() returns fresh results
```

---

## 4. Separate Repository Strategy

The documentation ingestion pipeline can (and should) live in its **own Git
repository**, separate from the main A-Team-Tracker application. The two repos
are connected only by a shared database and a CI trigger.

### Option 1 — Repository Dispatch (Recommended)

```
┌─────────────────────────┐         ┌─────────────────────────┐
│  A-Team-Tracker (this)  │         │  doc-ingestion-pipeline │
│                         │  event  │                         │
│  PR merged → GH Action ─┼────────▶│  GH Action runs:        │
│  (repository_dispatch)  │         │  1. Clones this repo    │
│                         │         │  2. Reads .md files     │
│                         │         │  3. Chunks & embeds     │
│                         │         │  4. Upserts to MongoDB  │
└─────────────────────────┘         └─────────────────────────┘
```

**In A-Team-Tracker** — add a workflow that dispatches an event when docs change:

```yaml
# .github/workflows/notify-doc-change.yml
name: Notify Doc Change

on:
  push:
    branches: [main]
    paths:
      - 'PRODUCT_DOCUMENTATION.md'
      - 'README.md'
      - 'docs/**'

jobs:
  dispatch:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger ingestion pipeline
        uses: peter-evans/repository-dispatch@v2
        with:
          token: ${{ secrets.PIPELINE_REPO_PAT }}
          repository: your-org/doc-ingestion-pipeline
          event-type: docs-updated
          client-payload: '{"repo": "A-Team-Tracker", "ref": "${{ github.sha }}"}'
```

**In the pipeline repo** — listen for the event:

```yaml
# .github/workflows/ingest.yml
name: Ingest Documentation

on:
  repository_dispatch:
    types: [docs-updated]

jobs:
  ingest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Clone source repo
        run: git clone https://github.com/your-org/A-Team-Tracker.git --depth 1
      - name: Install dependencies
        run: npm ci
      - name: Run ingestion
        env:
          MONGODB_URI: ${{ secrets.MONGODB_URI }}
        run: node dist/ingest.js ./A-Team-Tracker
```

**Pros:**
- ✅ Clean separation of concerns
- ✅ Automatic triggering on doc changes
- ✅ Independent versioning — pipeline evolves without touching app code
- ✅ Atlas `vector_index` auto-updates when `product_docs` changes

**Cons:**
- ⚠️ Requires a Personal Access Token (PAT) with `repo` scope stored as a secret

---

### Option 2 — Git Submodule

Add the pipeline repo as a submodule inside A-Team-Tracker:

```bash
git submodule add https://github.com/your-org/doc-ingestion-pipeline.git tools/doc-pipeline
```

- The pipeline code lives in its own repo with its own history.
- This repo pins a specific commit of the pipeline.
- CI in this repo can call `tools/doc-pipeline/ingest.js` directly after doc
  changes.

**Pros:**
- ✅ Pipeline version is pinned and tracked in this repo
- ✅ Single CI workflow

**Cons:**
- ⚠️ Submodules add complexity for contributors
- ⚠️ Must remember to update the submodule when the pipeline changes

---

### Option 3 — Shared MongoDB, No Git Link

The simplest "connection" is no Git link at all — just a shared database:

| Concern | A-Team-Tracker | Pipeline Repo |
|---|---|---|
| **Writes to** | — | `dhsync.product_docs` |
| **Reads from** | `dhsync.product_docs` (via `searchDocs()`) | — |
| **Shared secret** | `MONGODB_URI` in `server/.env` | Same `MONGODB_URI` in pipeline `.env` |
| **Trigger** | — | Webhook / manual / cron schedule |

The pipeline repo only needs:
1. The `MONGODB_URI` pointing to the same Atlas cluster.
2. The same embedding model (`Xenova/all-MiniLM-L6-v2`).
3. To write into the same collection (`product_docs`) with the same schema.

**Pros:**
- ✅ Zero coupling between repos
- ✅ Simplest to set up

**Cons:**
- ⚠️ No automatic trigger — must be run manually or on a cron schedule
- ⚠️ Risk of docs drifting out of sync

---

## 5. Contract Between Repos

Regardless of which strategy is chosen, the two repositories must agree on the
following interface:

### 5.1 MongoDB Collection Schema

**Database:** `dhsync`
**Collection:** `product_docs`

| Field | Type | Description |
|---|---|---|
| `_id` | `ObjectId` or `string` | Deterministic ID based on source + section + chunk index |
| `text` | `string` | The chunk's plain text content |
| `metadata.source` | `string` | Source file name (e.g. `"PRODUCT_DOCUMENTATION.md"`) |
| `metadata.page` | `number` | Section or page index |
| `embedding` | `number[]` (384-dim) | Vector produced by `Xenova/all-MiniLM-L6-v2` |

### 5.2 Vector Index Configuration

| Setting | Value |
|---|---|
| Index name | `vector_index` |
| Path | `embedding` |
| Dimensions | `384` |
| Similarity | `cosine` |

### 5.3 Embedding Model

Both repos **must** use the same embedding model: `Xenova/all-MiniLM-L6-v2`.

> ⚠️ **Critical:** If the pipeline repo uses a different model (or a different
> version), the vectors will be incompatible and search results will be
> meaningless. This is the most important contract.

---

## 6. Key Design Decisions

| Decision | Recommendation | Rationale |
|---|---|---|
| **Trigger mechanism** | GitHub Actions + repository dispatch | Reliable, auditable, automatic |
| **Chunking strategy** | Section-based (by `##` headings) | Matches existing doc structure; semantically coherent chunks |
| **Embedding model** | `Xenova/all-MiniLM-L6-v2` (384-dim) | Already used at query time in `embedText()`; must be consistent |
| **Storage** | Same `product_docs` collection | No migration; Atlas vector index stays intact |
| **Upsert strategy** | Deterministic `_id` + `bulkWrite` | Idempotent; safe to re-run |
| **Diff awareness** | SHA-256 hash per chunk | Avoids redundant embedding calls |
| **Repo strategy** | Separate repo with repository dispatch | Clean separation; independent lifecycle |

---

## 7. Optional Enhancements

1. **Auto-doc generation** — Use an LLM to scan git diffs and suggest
   documentation updates to `PRODUCT_DOCUMENTATION.md`. A human reviews and
   merges.

2. **Multi-source ingestion** — Extend to also embed `README.md`, inline JSDoc
   comments, or API route definitions.

3. **Versioning** — Store a `docVersion` or `commitSha` field on each chunk so
   you can trace which commit a chunk originated from.

4. **Reindex status dashboard** — Surface the last reindex timestamp and chunk
   count in the admin UI.

5. **Slack / Teams notification** — Post a message when ingestion completes
   (or fails) so the team knows the chat assistant is up to date.

6. **Scheduled full reindex** — Run a weekly cron job that does a full
   re-ingestion as a safety net, even if no dispatch event was missed.

---

## References

- **Chat controller:** `server/src/controllers/chatController.ts`
- **Embedding utility:** `server/src/utils/embeddings.ts`
- **Product documentation:** `PRODUCT_DOCUMENTATION.md`
- **Server config:** `server/src/config/index.ts`
- [MongoDB Atlas Vector Search](https://www.mongodb.com/docs/atlas/atlas-vector-search/vector-search-overview/)
- [OpenRouter API](https://openrouter.ai/docs)
- [GitHub Repository Dispatch](https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#repository_dispatch)