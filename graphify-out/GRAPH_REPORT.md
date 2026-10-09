# Graph Report - VoiceIntent  (2026-10-07)

## Corpus Check
- Corpus is ~6,790 words - fits in a single context window. You may not need a graph.

## Summary
- 178 nodes · 222 edges · 14 communities (10 shown, 3 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Blockchain Backend Core
- Frontend TS Config
- Backend Package Scripts
- Frontend Node Config
- Frontend React App
- Frontend Package Setup
- Frontend DevDependencies
- Backend Dependencies
- Backend TS Config
- Database & Startup
- Frontend TS Roots
- Frontend Readme
- Frontend HTML

## God Nodes (most connected - your core abstractions)
1. `compilerOptions` - 18 edges
2. `compilerOptions` - 15 edges
3. `compilerOptions` - 9 edges
4. `SendIntent` - 8 edges
5. `getContactsCollection()` - 7 edges
6. `constructUnsignedTransaction()` - 6 edges
7. `scripts` - 5 edges
8. `getSenderAccount()` - 5 edges
9. `connectDB()` - 5 edges
10. `scripts` - 5 edges

## Surprising Connections (you probably didn't know these)
- `startServer()` --calls--> `connectDB()`  [EXTRACTED]
  backend/src/index.ts → backend/src/db.ts
- `startServer()` --calls--> `getContactsCollection()`  [EXTRACTED]
  backend/src/index.ts → backend/src/db.ts
- `validateIntent()` --calls--> `getContactsCollection()`  [EXTRACTED]
  backend/src/intent.ts → backend/src/db.ts

## Import Cycles
- None detected.

## Communities (14 total, 3 thin omitted)

### Community 0 - "Blockchain Backend Core"
Cohesion: 0.21
Nodes (17): constructUnsignedTransaction(), executeAndVerifyTransaction(), getSenderAccount(), publicClient, simulateAndPreviewTransaction(), TransactionPreview, walletClient, evaluateRisk() (+9 more)

### Community 1 - "Frontend TS Config"
Cohesion: 0.08
Nodes (23): compilerOptions, allowArbitraryExtensions, allowImportingTsExtensions, erasableSyntaxOnly, jsx, lib, module, moduleDetection (+15 more)

### Community 2 - "Backend Package Scripts"
Cohesion: 0.10
Nodes (20): description, devDependencies, mongodb-memory-server, tsx, @types/express, @types/node, typescript, @types/node (+12 more)

### Community 3 - "Frontend Node Config"
Cohesion: 0.10
Nodes (19): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, noEmit, noFallthroughCasesInSwitch (+11 more)

### Community 4 - "Frontend React App"
Cohesion: 0.12
Nodes (15): plugins, rules, react/only-export-components, react/rules-of-hooks, $schema, ApiResponse, App(), Intent (+7 more)

### Community 5 - "Frontend Package Setup"
Cohesion: 0.13
Nodes (14): dependencies, react, react-dom, name, private, scripts, build, dev (+6 more)

### Community 6 - "Frontend DevDependencies"
Cohesion: 0.13
Nodes (15): devDependencies, oxlint, @types/node, @types/react, @types/react-dom, typescript, vite, @vitejs/plugin-react (+7 more)

### Community 7 - "Backend Dependencies"
Cohesion: 0.15
Nodes (13): dependencies, cors, dotenv, express, mongodb, @types/cors, viem, cors (+5 more)

### Community 8 - "Backend TS Config"
Cohesion: 0.17
Nodes (11): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, module, outDir, rootDir, skipLibCheck, strict (+3 more)

### Community 9 - "Database & Startup"
Cohesion: 0.38
Nodes (7): closeDB(), connectDB(), Contact, getContactsCollection(), app, startServer(), validateIntent()

## Knowledge Gaps
- **98 isolated node(s):** `name`, `version`, `description`, `main`, `dev` (+93 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 101 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `dependencies` connect `Backend Dependencies` to `Backend Package Scripts`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **Why does `devDependencies` connect `Frontend DevDependencies` to `Frontend Package Setup`?**
  _High betweenness centrality (0.019) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _98 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Frontend TS Config` be split into smaller, more focused modules?**
  _Cohesion score 0.08333333333333333 - nodes in this community are weakly interconnected._
- **Should `Backend Package Scripts` be split into smaller, more focused modules?**
  _Cohesion score 0.09523809523809523 - nodes in this community are weakly interconnected._
- **Should `Frontend Node Config` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._
- **Should `Frontend React App` be split into smaller, more focused modules?**
  _Cohesion score 0.12418300653594772 - nodes in this community are weakly interconnected._