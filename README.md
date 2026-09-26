# Tinker — AI Architecture Diagram Studio 🛠️

> Real-time, voice-driven architecture diagramming powered by Gemini AI and interactive React Flow diagrams.

![Tinker Banner](https://img.shields.io/badge/Gemini-3.8%20Flash-blue?style=for-the-badge&logo=google)
![React](https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?style=for-the-badge&logo=typescript)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-3.4-38B2D9?style=for-the-badge&logo=tailwindcss)

---

## ✨ Features

- **🗣️ Natural Voice Architecture Control**: Speak architecture changes naturally (e.g. *"Client talks to load balancer"*, *"Add Redis between them"*, *"Remove it"*).
- **🤖 Gemini AI Integration**: Multi-turn NLU with function calling targeting automated diagram actions via Google Gemini models (`gemini-3.8-flash`).
- **🛡️ Offline / Local Rule Fallback**: Fully functional offline rule engine for demo scenarios and instant local operations without an API key.
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

### 2. Configure Environment (Optional)

Create a `.env` file in the project root:

```env
VITE_GEMINI_API_KEY=your_gemini_api_key_here
VITE_GEMINI_MODEL=gemini-3.8-flash
```

> **Note**: You can also enter and test your Gemini API key directly inside the app using the settings modal (stored securely in browser `localStorage`).

### 3. Start Development Server

```bash
npm run dev
```

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
