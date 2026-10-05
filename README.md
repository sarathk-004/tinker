# Tinker — AI Architecture Diagram Studio 🛠️

> Real-time, voice-driven architecture diagramming powered by Gemini AI and interactive React Flow diagrams.

![Tinker Banner](https://img.shields.io/badge/Gemini-3.8%20Flash-blue?style=for-the-badge&logo=google)
![React](https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?style=for-the-badge&logo=typescript)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-3.4-38B2D9?style=for-the-badge&logo=tailwindcss)

---

## ✨ Features

- **🗣️ Natural Voice Architecture Control**: Speak architecture changes naturally (e.g. *"Client talks to load balancer"*, *"Add Redis between them"*, *"Remove it"*).
- **🤖 Gemini AI Integration** *(returning in a later update, server-side)*: typed and voice commands with function calling.
- **💾 Saved diagrams**: sign in, edit, refresh, and your diagram is still there; edits retry safely and stale tabs cannot overwrite each other.
- **🔄 Auto-healing Connections**: Intelligently reconnects predecessor and successor nodes when intermediary nodes (like caches or proxies) are removed.
- **⚡ Parallel & Bidirectional Edges**: Full multigraph Dagre layout support for bidirectional services and multi-channel connections.
- **🎨 Interactive Canvas**: Powered by `@xyflow/react` with custom styled nodes, auto-layout (LR & TB), highlighting, and status feedback.

---

## 🚀 Quick Start

### 1. Clone & Install Dependencies

```bash
git clone https://github.com/<your-username>/tinker.git
cd tinker
npm install
```

### 2. Configure the environment

Browser settings (root `.env`; everything here is public and ships in the bundle, so **never put a secret in a `VITE_*` variable**):

```env
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxxxxxx   # public by design; never the secret/service_role key
```

Server settings live in `server/.env` (see `server/.env.example` and `server/README.md`): database, Supabase, and later the Gemini key.
The Gemini key is server-side only. The app no longer calls Gemini from the browser, and typed/voice commands return in a later update.

### 3. Start the app

```bash
npm run dev:db  -w @tinker/server     # local Postgres (first time: npm run db:migrate -w @tinker/server)
npm run dev:api                       # API on :8787  (or: npm run dev:api:supabase for your Supabase project)
npm run dev                           # frontend on :5173
```

Sign in with Supabase (or, in local development only, "Developer login" when the API runs with `AUTH_MODE=dev`).

### 4. Build for Production

```bash
npm run build
```

---

## 💡 Example Voice / Text Commands

- *"Client talks to load balancer"*
- *"Add Redis between them"*
- *"Remove it"*
- *"Add a payments service and connect it to postgres"*
- *"Highlight load balancer"*
- *"Reset canvas"*

---

## 🛠️ Tech Stack

- **Framework**: React 18 + Vite
- **Language**: TypeScript
- **State Management**: Zustand
- **Diagramming & Layout**: `@xyflow/react` + `@dagrejs/dagre` (Multigraph enabled)
- **Styling**: Tailwind CSS + Lucide Icons
- **AI**: Google Gemini API (`generateContent` with Function Calling & Bidi Streaming)
