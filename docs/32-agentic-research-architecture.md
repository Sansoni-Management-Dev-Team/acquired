# Production agentic research architecture

The Vercel application owns authentication, research configuration, database writes, evidence validation, and job dispatch. Cloudflare Workflows execute resumable research jobs. Supabase stores the shared job state and provider reservations; the Workers reach it through authenticated Vercel callbacks.

```mermaid
flowchart TD
    U[User starts Discover] --> API
    subgraph Vercel["Vercel — application and coordination"]
        API[Authenticate and validate scope and budget]
        D[Dispatch discovery, candidate and enrichment jobs]
        CB[Authenticated internal callbacks]
        Q[Reserve browser or AI capacity]
        V[Validate evidence and save progress]
        UI[Discover UI polls progress and results]
    end
    DB[(Supabase Postgres<br/>Jobs, evidence, targets and shared provider queue)]
    API --> DB
    API --> D
    D --> W
    subgraph CF["MLAI Cloudflare"]
        W[Research Worker<br/>Start named Workflow instances]
        WF[Durable Workflow per job<br/>Checkpoints, retries, sleeps and budgets]
        CH{Next research action}
        S[Worker search endpoint<br/>Parse DuckDuckGo results]
        CACHE{Page in run cache?}
        BR[Browser Rendering<br/>Read public page as markdown]
        FB[Crawl4AI Worker and container<br/>Fallback page reader]
        CONTENT[Usable page content]
        W --> WF --> CH
        CACHE -->|Hit| CONTENT
        CACHE -->|Miss| BR
        BR -->|Usable page| CONTENT
        BR -->|Read failure or unusable content| FB
        FB -->|Usable page| CONTENT
    end
    AI[OpenRouter models<br/>Plan queries, extract facts and choose follow-ups]
    WEB[Public websites and search pages]
    CH -->|Search, page read or AI call| CB
    CB --> Q
    Q <--> DB
    Q -->|No slot yet| WAIT[Workflow sleeps and retries admission]
    WAIT --> WF
    Q -->|AI slot granted| AI
    Q -->|Search slot granted| S
    Q -->|Page slot granted| CACHE
    S -->|Render search results page| BR
    BR -->|Search markdown| S
    BR <--> WEB
    FB <--> WEB
    S -->|Candidate URLs via app callback| D
    CONTENT -->|Extract after AI admission| AI
    AI -->|Decision or structured findings| WF
    WF -->|Progress and findings| CB
    CB --> V --> DB
    V -->|More candidates or follow-ups within budget| D
    UI -->|Poll; may dispatch continuations| API
    DB -->|Saved results via app| UI
```

Search result snippets supply leads rather than verified evidence. Company pages provide facts which are checked before saving. The diagram shows the main production path; legacy asynchronous crawl support and local Docker development services are omitted.

Browser page reads and web searches share account-wide admission control. The AI provider has its own admission policy. Multiple jobs can be active while most are waiting for a browser or AI slot. A partial job can still contain useful evidence, or can represent an unsuccessful read; it is not equivalent to a clean success.

The adaptive loop generates the next query from scope, previous searches and candidate outcomes. Candidates become separate jobs, and automatic continuations keep searching until the target or configured budget/deadline is reached. UI polling also performs recovery and dispatch checks, so it is part of coordination rather than a purely passive read.
