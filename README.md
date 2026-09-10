# LifeFlow — Personal Daily Dashboard

A beautiful, iOS-inspired personal life management dashboard. Manage your notes, tasks, habits, expenses, and daily life — all in one place.

---

## Features

| Module | Status |
|--------|--------|
| 🔐 Authentication (signup / login / logout) | ✅ Phase 1 |
| 🏠 Dashboard overview | ✅ Phase 1 |
| 📝 Notes | 🔜 Phase 2 |
| ✅ Tasks with priority & due dates | 🔜 Phase 2 |
| 🔥 Habits & streaks | 🔜 Phase 2 |
| 💰 Expense tracking | 🔜 Phase 2 |
| 📊 Spending analytics | 🔜 Phase 2 |
| 🔔 Notifications | 🔜 Phase 2 |
| 👤 Profile & preferences | 🔜 Phase 2 |

---

## Tech Stack

- **Framework** — Next.js 15 (App Router)
- **Language** — TypeScript (strict)
- **Styling** — Tailwind CSS v4
- **Database** — MongoDB + Mongoose
- **Auth** — iron-session (secure cookie sessions)
- **Animations** — Framer Motion
- **Icons** — Lucide React
- **Charts** — Recharts (Phase 2)
- **Validation** — Zod
- **Forms** — React Hook Form

---

## Project Structure

```
lifeflow/
├── app/
│   ├── (auth)/          # Login, signup pages
│   ├── (app)/           # Protected app routes
│   │   ├── dashboard/
│   │   ├── notes/
│   │   ├── tasks/
│   │   ├── habits/
│   │   ├── expenses/
│   │   ├── analytics/
│   │   ├── notifications/
│   │   └── profile/
│   └── api/             # API route handlers
│       ├── auth/
│       ├── notes/
│       ├── tasks/
│       └── habits/
├── components/
│   ├── ui/              # Glass design system
│   ├── layout/          # Sidebar, BottomNav, AppHeader
│   ├── dashboard/
│   └── ...feature components
├── lib/
│   ├── db.ts            # MongoDB connection
│   ├── session.ts       # iron-session config
│   ├── utils.ts         # Helpers & constants
│   └── validations.ts   # Zod schemas
├── models/              # Mongoose models
│   ├── User.ts
│   ├── Note.ts
│   ├── Task.ts
│   ├── Habit.ts
│   ├── HabitLog.ts
│   ├── Expense.ts
│   └── Notification.ts
├── types/
│   └── index.ts         # Shared TypeScript types
└── middleware.ts        # Route protection
```

---

## Environment Variables

Copy `.env.example` to `.env.local` and fill in:

```env
# MongoDB
MONGODB_URI=mongodb://localhost:27017/lifeflow

# Iron Session (min 32 chars)
SESSION_SECRET=your-secret-key-at-least-32-characters-long

# App URL
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Generate a secure session secret:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

---

## MongoDB Setup

**Local:**
1. Install MongoDB Community: https://www.mongodb.com/try/download/community
2. Start: `mongod --dbpath /data/db`
3. Set `MONGODB_URI=mongodb://localhost:27017/lifeflow`

**MongoDB Atlas (cloud):**
1. Create a free cluster at https://cloud.mongodb.com
2. Create a database user and get your connection string
3. Set `MONGODB_URI=mongodb+srv://<user>:<password>@cluster.mongodb.net/lifeflow`

---

## Local Development

```bash
# Install dependencies
npm install

# Copy env file
cp .env.example .env.local
# Edit .env.local with your values

# Start dev server
npm run dev
```

Open http://localhost:3000

---

## Production Build

```bash
npm run build
npm start
```

---

## Authentication

- Passwords are hashed with **bcryptjs** (cost factor 12)
- Sessions use **iron-session** — encrypted, HTTP-only, secure cookies
- Session secret must be at least 32 characters
- Middleware protects all `/app/*` routes server-side
- User ownership is always verified server-side — no client-supplied userId is trusted

---

## Security Notes

- Passwords are never stored in plain text or logged
- Every database query for user data filters by the authenticated `userId` from the server session
- Input validation with Zod on all API routes
- CSRF protection via `sameSite: lax` cookie setting
- Never commit `.env.local` — it is in `.gitignore`

---

## Seed Data (Development)

Coming in a future phase. Will include sample tasks, habits, notes, and expenses to demonstrate the dashboard.
