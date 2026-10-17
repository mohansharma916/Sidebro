# System Design Library — What's Downloaded & How to Use It

This lists every book, guide and paper downloaded into [`library/`](library/) to answer system design interview questions, from fundamentals to practical, real-world depth. Everything here is **free and legally redistributable** (open license or published free by the author/company). Paid books are listed separately at the end as recommendations. They were **not** downloaded.

> To fetch or refresh the library: `bash doc/system-design/download-library.sh`. The folder is gitignored because it is ~45 MB.

For the condensed answers, see **[SYSTEM_DESIGN_QUICK_ANSWERS.md](SYSTEM_DESIGN_QUICK_ANSWERS.md)**.

---

## 📚 Downloaded resources

### 1. The System Design Primer, by Donne Martin
- **Path:** `library/system-design-primer/`
- **Source:** https://github.com/donnemartin/system-design-primer (~375K ⭐, the most popular SD resource on GitHub)
- **License:** CC BY 4.0
- **What it covers:** The interview approach, scalability fundamentals, every core building block (DNS, CDN, LB, caching, DB patterns, async, consistency), latency numbers, and **worked solutions with code** for Pastebin, Twitter, web crawler, Mint, social graph, sales rank and scaling on AWS.
- **Use it for:** Theory questions plus the "how do I start?" framework. Start in `README.md`; the worked solutions are in `solutions/system_design/*/README.md`.
- **Practical level:** ⭐⭐⭐ Foundations. It isn't enough on its own for senior roles, so pair it with #2 and #3.

### 2. System Design (open-source book), by Karan Pratap Singh
- **Path:** `library/karanpratapsingh-system-design/README.md` (one long book file, with diagrams in `diagrams/`)
- **Source:** https://github.com/karanpratapsingh/system-design (~47K ⭐)
- **License:** CC BY-NC-ND 4.0 (personal, non-commercial use)
- **What it covers:** A complete course in book form. Chapters run from networking → databases → CAP/PACELC → sharding and consistent hashing → microservices, EDA, CQRS → API styles, WebSockets, geohashing, rate limiting, circuit breakers, OAuth/SSO → **five full end-to-end case studies: URL Shortener, WhatsApp, Twitter, Netflix and Uber**. Each case study includes requirements, estimates, data model, API, HLD and a detailed design.
- **Use it for:** The best single read for **practical, end-to-end answers**. The case studies follow the same structure an interviewer expects.
- **Practical level:** ⭐⭐⭐⭐ Interview-ready.

### 3. System Design 101, by ByteByteGo (Alex Xu's team)
- **Path:** `library/bytebytego-system-design-101/data/guides/` (~400 short guides) and `data/categories/` (topic indexes)
- **Source:** https://github.com/ByteByteGoHq/system-design-101 (~90K ⭐)
- **License:** CC BY-NC-ND 4.0
- **What it covers:** Bite-sized, visual explanations of how real systems work: chat apps, Google Docs, YouTube uploads, Google Maps, stock exchanges, payments, Kafka internals, cache failure modes, DB scaling strategies, API design, security, Kubernetes, CI/CD and more.
- **Use it for:** Quick refreshers and **"how does X work in the real world"** questions. Grep the `guides/` folder by keyword.
- **Practical level:** ⭐⭐⭐⭐ Real-world patterns.

### 4. Awesome System Design Resources, by Ashish Pratap Singh (AlgoMaster)
- **Path:** `library/awesome-system-design-resources/`
- **Source:** https://github.com/ashishps1/awesome-system-design-resources (~42K ⭐)
- **License:** GPL-3.0
- **What it covers:** A curated roadmap of concepts, patterns, engineering blogs and interview problems. It also includes **runnable Java and Python implementations** in `implementations/` (rate-limiting algorithms, consistent hashing, load balancing and more) and an interview template diagram.
- **Use it for:** "Can you code a rate limiter or consistent hash ring?" follow-ups, and finding the best article for any topic.

### 5. Awesome Scalability, by Binh Nguyen
- **Path:** `library/awesome-scalability/README.md`
- **Source:** https://github.com/binhnguyennus/awesome-scalability (~75K ⭐)
- **License:** MIT
- **What it covers:** Links to **real engineering-blog case studies** from Netflix, Uber, Airbnb, Discord, Slack, Pinterest, Facebook and others. They're grouped by scalability, availability, stability, performance and org patterns.
- **Use it for:** Citing how a real company solved the problem, which is a strong senior signal. ("Discord moved messages from Cassandra to ScyllaDB because…")

### 6. AWS Well-Architected Framework (whitepaper)
- **Path:** `library/aws-well-architected-framework.pdf`
- **Source:** https://docs.aws.amazon.com/wellarchitected/latest/framework/welcome.html (free official PDF)
- **What it covers:** Six pillars: operational excellence, security, reliability, performance efficiency, cost optimization and sustainability. Each comes with concrete design principles and best practices.
- **Use it for:** **Non-functional requirements** and the wrap-up section (reliability, DR, cost, security), plus cloud-specific interviews.

### 7. Foundational distributed systems papers (`library/papers/`)
These are the original papers behind most "design X" questions. They're freely published by the authors and companies.

| File | Paper | Why it matters in interviews |
|---|---|---|
| `dynamo-amazon-2007.pdf` | Amazon Dynamo | Consistent hashing, quorum, vector clocks, hinted handoff. Basis of the **"design a key-value store"** question |
| `gfs-google-2003.pdf` | Google File System | Distributed file storage, chunking, master/chunkserver design |
| `bigtable-google-2006.pdf` | Bigtable | Wide-column store, SSTables/LSM. Basis of HBase and Cassandra's storage engine |
| `mapreduce-google-2004.pdf` | MapReduce | Batch processing at scale |
| `spanner-google-2012.pdf` | Spanner | Globally consistent DB, TrueTime. Counter-example to "CAP means no strong consistency at scale" |
| `kafka-linkedin-2011.pdf` | Kafka | Log-based messaging, partitions, consumer offsets |

**Use them for:** The deep dive. Reading the abstract and architecture section of each takes ~15 minutes and lets you answer "why" questions with authority.

---

## 🗺️ Which resource answers which question?

| Question type | Go to |
|---|---|
| "How do you approach a design problem?" | Primer → *How to approach*; Karan → *System Design Interviews* |
| Concept definitions (CAP, sharding, caching…) | Karan's book (clearest) → Primer (more depth) |
| End-to-end "Design X" (URL shortener, WhatsApp, Twitter, Netflix, Uber) | **Karan's case studies** |
| Pastebin, web crawler, social graph, AWS scaling | Primer `solutions/` |
| Gmail, Google Docs, Maps, YouTube, stock exchange, payments, chat | ByteByteGo `guides/` |
| "Write code for a rate limiter / LB / hash ring" | awesome-system-design-resources `implementations/` |
| "How did company X really do it?" | awesome-scalability |
| Reliability, DR, security, cost, NFRs | AWS Well-Architected PDF |
| "Design a KV store / distributed DB / message queue" | `papers/` (Dynamo, Bigtable, Spanner, Kafka) |

## ⏱️ Suggested study path (≈ 2 weeks)
1. **Days 1–3:** Karan's book, chapters on fundamentals through Rate Limiting.
2. **Days 4–5:** Primer README (fill gaps, memorize the latency numbers).
3. **Days 6–9:** Karan's five case studies + Primer solutions. Practice each one aloud using the 45-minute framework in the quick-answer sheet.
4. **Days 10–11:** Skim ByteByteGo guides for the real-world systems you're likely to be asked (by company).
5. **Days 12–13:** Dynamo + Kafka papers (architecture sections only), plus 3–4 awesome-scalability case studies.
6. **Day 14:** Review [SYSTEM_DESIGN_QUICK_ANSWERS.md](SYSTEM_DESIGN_QUICK_ANSWERS.md) and do one mock interview.

---

## 🔗 Free to read online (no download available)
- **Google SRE books** (*Site Reliability Engineering*, *The SRE Workbook*, *Building Secure & Reliable Systems*): https://sre.google/books/. The best source on SLOs, monitoring, incident response and reliability.
- **Microsoft Azure Cloud Design Patterns**: https://learn.microsoft.com/azure/architecture/patterns/. Catalog of ~40 patterns (Saga, CQRS, Bulkhead, Strangler Fig…).
- **High Scalability blog**: https://highscalability.com/. Classic real-world architecture write-ups.

## 💰 Best paid books (recommended, not downloaded)
These are the gold standard. Buy them or borrow them through a library or O'Reilly subscription.
1. **Designing Data-Intensive Applications** by Martin Kleppmann (O'Reilly; 2nd edition with Chris Riccomini). The deepest "why" book. *The* book for senior roles.
2. **System Design Interview – An Insider's Guide, Vol. 1 & 2** by Alex Xu (and Sahn Lam for Vol. 2). The most interview-focused books, with about 28 worked problems.
3. **Grokking the System Design Interview** (DesignGurus course). Pattern-based problem walkthroughs.
4. **Hello Interview** (hellointerview.com). Free written guides plus paid mock interviews with FAANG engineers.
