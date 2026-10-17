# System Design — Quick Answer Sheet

A one-stop sheet of short, spoken-style answers for system design interviews. Each section ends with a **📖 Deep dive** pointer into the downloaded library (see [RESOURCES.md](RESOURCES.md)).

---

## 1. The 45-Minute Framework (say this out loud)

| Step | Time | What you do | Phrase to use |
|---|---|---|---|
| 1. Requirements | 5 min | Functional + non-functional (scale, latency, consistency, availability) | "Before I design, let me pin down scope…" |
| 2. Estimates | 3–5 min | DAU, QPS (avg + peak), storage/yr, bandwidth | "Rough numbers so we size things correctly…" |
| 3. API | 3 min | 3–5 core endpoints | "Here's the contract clients will call…" |
| 4. Data model | 5 min | Entities, keys, SQL vs NoSQL choice | "Access pattern drives the store choice…" |
| 5. High-level design | 10 min | Client → LB → services → cache → DB → queue | "Let me draw the happy path first…" |
| 6. Deep dive | 10–15 min | 1–2 bottlenecks the interviewer cares about | "The hardest part here is X, so let's go deep…" |
| 7. Wrap-up | 3 min | Failure modes, monitoring, trade-offs, future work | "If I had more time, I'd…" |

> **Golden rule:** Every choice = *decision + reason + trade-off*. "I'll use Cassandra **because** writes dominate and we need multi-region, **at the cost of** weaker consistency."

📖 Deep dive: `library/system-design-primer/README.md` → *How to approach a system design interview question*; `library/karanpratapsingh-system-design/README.md` → *System Design Interviews*.

---

## 2. Numbers Every Engineer Should Know

**Latency (approx.)**
| Operation | Time |
|---|---|
| L1 cache reference | 0.5 ns |
| Main memory reference | 100 ns |
| Read 1 MB sequentially from memory | ~3 µs |
| SSD random read | ~16–100 µs |
| Round trip within same datacenter | 0.5 ms |
| Read 1 MB sequentially from SSD | ~50 µs–1 ms |
| Disk seek (HDD) | 10 ms |
| Round trip CA ↔ Netherlands | 150 ms |

**Back-of-envelope cheats**
- 1 day ≈ **86,400 s ≈ 10⁵ s** → 1M requests/day ≈ **12 QPS**; 100M/day ≈ **1,200 QPS**.
- Peak QPS ≈ **2–3× average**.
- Read:write ratio for social apps ≈ **100:1**.
- 1 char = 1 byte (ASCII); UUID = 16 B; typical tweet/post row ≈ 300 B–1 KB.
- Single well-tuned Postgres/MySQL: ~**5–10K QPS** simple reads; Redis: ~**100K+ ops/s** per node.
- Availability: 99.9% = **8.76 h/yr** down; 99.99% = **52.6 min/yr**; 99.999% = **5.26 min/yr**.

📖 Deep dive: `library/system-design-primer/README.md` → *Appendix: Powers of two table / Latency numbers*.

---

## 3. Core Building Blocks — 1-Line Answers

| Concept | Quick answer |
|---|---|
| **Load balancer** | Spreads traffic across servers; L4 (TCP, fast) vs L7 (HTTP-aware, path routing). Algorithms: round-robin, least-connections, consistent hashing. Make it redundant (active-passive). |
| **Reverse proxy** | Single entry point: TLS termination, caching, compression, hides backends. LB *is* a reverse proxy with multiple backends. |
| **CDN** | Edge cache for static/media. **Pull** = lazy fetch on miss (simple); **Push** = you upload (good for big, rarely-changing files). |
| **Caching** | Cache-aside (most common), write-through (consistent, slower writes), write-back (fast, risk of loss). Evict with LRU/LFU. Hard part = invalidation + stampede (use TTL jitter, request coalescing). |
| **SQL vs NoSQL** | SQL: relations, transactions, ad-hoc queries. NoSQL: massive scale, flexible schema, known access patterns. Default to SQL unless scale/access pattern says otherwise. |
| **Replication** | Leader-follower (read scaling, replica lag), multi-leader (multi-region writes, conflicts), leaderless/quorum (W + R > N for strong reads). |
| **Sharding** | Split data by key. Range (hotspots risk), hash (even spread, no range queries), directory (flexible, extra lookup). Pick a high-cardinality shard key aligned with queries. |
| **Consistent hashing** | Hash ring + virtual nodes → adding/removing a node moves only ~1/N keys. Used by Dynamo, Cassandra, CDN, caches. |
| **Indexes** | B-tree for range/equality (read-heavy), LSM-tree for write-heavy. Indexes speed reads, slow writes. |
| **Message queue** | Decouple + absorb spikes + async work. At-least-once delivery → consumers must be **idempotent**. Kafka = log, replayable, ordered per partition; RabbitMQ/SQS = task queue. |
| **Pub/Sub** | One event → many subscribers (fan-out). |
| **API Gateway** | Auth, rate-limit, routing, aggregation in front of microservices. |
| **Rate limiting** | Token bucket (allows bursts), leaky bucket (smooth), fixed/sliding window counters. Store counters in Redis; return HTTP 429. |
| **Circuit breaker** | Closed → Open (fail fast after N errors) → Half-open (probe). Prevents cascading failure. |
| **Service discovery** | Registry (Consul, etcd, k8s DNS) so services find each other dynamically. |
| **Real-time** | Polling (simple, wasteful) → Long-polling → **SSE** (server→client stream) → **WebSockets** (full duplex, chat/games). |
| **Geo search** | Geohash (string prefix = area) or Quadtree (adaptive density). Used for Uber/Yelp "nearby". |
| **Blob storage** | Store files in object storage (S3), metadata in DB, serve via CDN with signed URLs. |
| **Bloom filter** | Probabilistic "definitely not / maybe yes" set — saves DB lookups (crawler seen-URLs, username taken). |

📖 Deep dive: `library/karanpratapsingh-system-design/README.md` (chapters on each topic); `library/bytebytego-system-design-101/data/guides/` (visual one-pagers).

---

## 4. Theory Questions — Crisp Answers

**Q: Explain CAP theorem.**
In a network partition you must choose **Consistency** (reject/wait) or **Availability** (serve possibly stale data). Partitions are unavoidable, so it's really CP vs AP. Banking/inventory → CP; social feed/likes → AP. Mention **PACELC**: *even without partitions*, you trade **Latency vs Consistency**.

**Q: Strong vs eventual consistency?**
Strong: every read sees the latest write (single leader, quorum, Spanner). Eventual: replicas converge over time (DNS, Cassandra default). Middle grounds: read-your-writes, monotonic reads, causal.

**Q: ACID vs BASE?**
ACID = Atomic, Consistent, Isolated, Durable (relational, transactions). BASE = Basically Available, Soft state, Eventually consistent (NoSQL at scale).

**Q: How do you handle distributed transactions?**
Avoid them if possible. Options: **2PC** (strong, blocking, coordinator SPOF) or **Saga** (sequence of local transactions with compensating actions — preferred in microservices). Use **outbox pattern** to atomically write DB + publish event.

**Q: Vertical vs horizontal scaling?**
Vertical = bigger box (simple, ceiling, SPOF). Horizontal = more boxes (unbounded, needs stateless services + data partitioning).

**Q: Monolith vs microservices?**
Start monolith (speed, simplicity). Split when teams/scale demand independent deploys. Microservices cost: network calls, distributed data, observability, ops overhead.

**Q: How do you make an API idempotent?**
Client sends an `Idempotency-Key`; server stores key → result; replays return the stored result. PUT/DELETE are naturally idempotent; POST is not.

**Q: How to design for high availability?**
Remove SPOFs (redundancy at every layer), multi-AZ/region, health checks + auto-failover, graceful degradation, timeouts + retries with exponential backoff + jitter, circuit breakers, bulkheads.

**Q: SLA vs SLO vs SLI?**
SLI = measured metric (p99 latency). SLO = internal target (p99 < 200 ms, 99.9%). SLA = contractual promise with penalties. Error budget = 100% − SLO.

**Q: Event sourcing & CQRS?**
Event sourcing: store every state change as an immutable event; current state = replay. CQRS: separate write model from read model(s), often fed by events. Great for audit/finance; cost = complexity + eventual consistency.

**Q: REST vs GraphQL vs gRPC?**
REST: simple, cacheable, public APIs. GraphQL: client chooses fields, great for varied front-ends; harder caching. gRPC: binary (protobuf), HTTP/2, streaming — best for internal service-to-service.

📖 Deep dive: `library/papers/` (Dynamo = AP/eventual, Spanner = CP/global strong consistency); `library/karanpratapsingh-system-design/README.md` → *CAP, PACELC, Transactions, Distributed Transactions*.

---

## 5. Classic Design Questions — Answer Skeletons

### URL Shortener (TinyURL / bit.ly)
- **Reqs:** shorten, redirect (<50 ms), custom alias, expiry, analytics. Read-heavy (100:1).
- **Key gen:** Base62 of a unique ID (7 chars ≈ 3.5 trillion). ID from a **Key Generation Service** / pre-generated key pool or Snowflake ID — avoid hash collisions.
- **Store:** KV store (DynamoDB/Cassandra) `short → long`. **Cache** hot links in Redis.
- **Redirect:** 301 (cacheable, less analytics) vs 302 (every hit tracked).
- **Analytics:** async via Kafka → stream processing.
📖 `karanpratapsingh-system-design/README.md` → *URL Shortener*; `system-design-primer/solutions/system_design/pastebin/`

### Twitter / News Feed
- **Fan-out on write** (push to followers' cached timelines) — fast reads; bad for celebrities.
- **Fan-out on read** (pull at read time) — for celebrities. **Hybrid** is the answer.
- Timeline cache in Redis (list of tweet IDs); tweets in sharded store; media in S3 + CDN; search via Elasticsearch.
📖 `karanpratapsingh-system-design/README.md` → *Twitter*; `system-design-primer/solutions/system_design/twitter/`

### Chat App (WhatsApp / Messenger)
- **WebSockets** for persistent connections; connection-registry (user → gateway server) in Redis.
- Message flow: sender → chat service → store (Cassandra, partition by `conversation_id`, sort by time) → push to recipient's gateway, or queue for offline + push notification.
- Delivery receipts (sent/delivered/read), message IDs per conversation for ordering, presence via heartbeats.
- Group chat: fan-out via queue; E2E encryption (Signal protocol) mention.
📖 `karanpratapsingh-system-design/README.md` → *WhatsApp*; `bytebytego-system-design-101/data/guides/how-do-we-design-a-chat-application-like-whatsapp-facebook-messenger-or-discord.md`

### Video Streaming (YouTube / Netflix)
- Upload → object storage → **transcoding pipeline** (queue + workers) → multiple resolutions/codecs → **adaptive bitrate** (HLS/DASH) segments → CDN.
- Metadata in SQL; views/likes counters async; recommendations offline.
- Netflix: own CDN (Open Connect) placed inside ISPs.
📖 `karanpratapsingh-system-design/README.md` → *Netflix*; `bytebytego-system-design-101/data/guides/how-does-youtube-handle-massive-video-content-upload.md`

### Ride Sharing (Uber)
- Drivers push location every ~4 s → location service (in-memory geo index: **geohash/quadtree**, Redis GEO).
- Matching service finds nearby drivers, offers ride, handles accept/timeout.
- Trip state machine; payments async; surge pricing per geo cell; WebSockets for live tracking.
📖 `karanpratapsingh-system-design/README.md` → *Uber*

### Rate Limiter
- Where: API gateway / middleware. Algorithm: **token bucket** (default answer) or sliding window log/counter.
- Store counters in Redis with atomic ops (Lua script / INCR + EXPIRE). Distributed → per-node local + sync, or centralized Redis.
- Return `429` + `Retry-After`, `X-RateLimit-Remaining` headers.
📖 `karanpratapsingh-system-design/README.md` → *Rate Limiting*; `awesome-system-design-resources/implementations/` (code)

### Web Crawler
- URL frontier (priority + politeness queues per host) → fetchers → parser → dedupe (**Bloom filter** on URLs, hash on content) → store → extract links back to frontier.
- Respect robots.txt, DNS cache, distributed by hashing host.
📖 `system-design-primer/solutions/system_design/web_crawler/`; `bytebytego-system-design-101/data/guides/how-to-avoid-crawling-duplicate-urls-at-google-scale.md`

### Distributed Cache / Key-Value Store
- Consistent hashing + virtual nodes, replication factor N, quorum W/R, **vector clocks** or LWW for conflicts, gossip for membership, hinted handoff + Merkle trees for repair. (This *is* the Dynamo paper.)
📖 `library/papers/dynamo-amazon-2007.pdf`

### Notification System
- Producers → queue (Kafka) → notification service → per-channel workers (APNs/FCM, SMS, email) → retries + DLQ. User preferences + rate limits + templates; idempotency key to avoid duplicates.

### Google Docs (collaborative editing)
- WebSockets; **OT** (Operational Transform) or **CRDTs** to merge concurrent edits; document snapshot + op log; presence/cursors via pub/sub.
📖 `bytebytego-system-design-101/data/guides/how-to-design-google-docs.md`

### Payment System
- Idempotency keys everywhere, double-entry ledger, **exactly-once effect** via idempotent consumers, reconciliation jobs with the PSP, Saga for multi-step flows, strong consistency (SQL).
📖 `bytebytego-system-design-101/data/categories/payment-and-fintech.md`

---

## 6. Trade-offs Cheat Sheet (the "senior signal")

| Choice | Pick A when… | Pick B when… |
|---|---|---|
| SQL ↔ NoSQL | relations, transactions, ad-hoc queries | huge write scale, simple access patterns, flexible schema |
| Consistency ↔ Availability | money, inventory, booking | feeds, likes, view counts |
| Push ↔ Pull (fan-out) | normal users, read-latency critical | celebrities, write amplification too high |
| Cache-aside ↔ Write-through | read-heavy, tolerate staleness | must never read stale |
| Sync ↔ Async | user needs result now | slow/expensive work, spikes |
| Monolith ↔ Microservices | small team, early stage | many teams, independent scaling |
| Polling ↔ WebSockets | infrequent updates | real-time bidirectional |
| 301 ↔ 302 redirect | reduce load | need analytics |

📖 `bytebytego-system-design-101/data/guides/10-system-design-tradeoffs-you-cannot-ignore.md`

---

## 7. Closing Lines That Impress

- **Failure modes:** "What happens if the cache cluster dies? → thundering herd on DB → we add request coalescing and a circuit breaker."
- **Observability:** metrics (RED/USE), distributed tracing, structured logs, alerting on SLOs.
- **Security:** authN/authZ (OAuth2/OIDC), TLS/mTLS, encryption at rest, input validation, rate limits.
- **Cost:** "Cold data moves to cheaper storage tiers (S3 IA/Glacier)."
- **Evolution:** "V1 is single-region; V2 goes multi-region active-active once we need it."
