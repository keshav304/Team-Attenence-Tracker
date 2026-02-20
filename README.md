# 📍 dhSync

Internal web application for a team to plan and track daily work location visibility.

## Overview

A shared planning tool where team members mark their daily status:
- 🏢 **Office** — Working from the office
- 🌴 **Leave** — On leave (for visibility only, no approval workflow)
- 🏠 **WFH** — Working from home (default, implicit)

Only `office` and `leave` are stored. If no entry exists → WFH.

## Tech Stack

| Layer    | Technology                          |
|----------|-------------------------------------|
| Frontend | React 18 + TypeScript + Tailwind CSS |
| Backend  | Node.js + Express + TypeScript      |
| Database | MongoDB + Mongoose                  |
| Auth     | JWT (JSON Web Tokens)               |
| Bundler  | Vite                                |

## Project Structure

```
A-Team-Tracker/
├── client/               # React frontend
│   ├── src/
│   │   ├── api/          # Axios API client & endpoint functions
│   │   ├── context/      # AuthContext (React Context)
│   │   ├── pages/        # Page components
│   │   ├── components/   # Shared components (Layout)
│   │   ├── types/        # TypeScript interfaces
│   │   └── utils/        # Date helpers
│   └── ...
├── server/               # Express backend
│   ├── src/
│   │   ├── config/       # DB connection & env config
│   │   ├── controllers/  # Route handlers
│   │   ├── middleware/    # Auth middleware
│   │   ├── models/       # Mongoose schemas
│   │   ├── routes/       # Express routers
│   │   ├── types/        # TypeScript interfaces
│   │   ├── utils/        # Date helpers
│   │   ├── index.ts      # Server entry point
│   │   └── seed.ts       # Database seeder
│   └── ...
└── package.json          # Root scripts
```

## Getting Started

### Prerequisites

- **Node.js** 18+
- **MongoDB** running locally (or a MongoDB Atlas connection string)

### 1. Install dependencies

```bash
npm install           # root (installs concurrently)
npm run install:all   # installs server + client dependencies
```

### 2. Configure environment

```bash
cp server/.env.example server/.env
# Edit server/.env with your MongoDB URI and JWT secret
```

### 3. Seed the database (optional)

```bash
npm run seed
```

This creates:
- **Admin**: `admin@team.com` / `admin123`
- **Members**: `alice@team.com`, `bob@team.com`, `charlie@team.com`, `diana@team.com`, `eve@team.com` (all use `password123`)
- **10 public holidays** for 2026

### 4. Run in development

```bash
npm run dev
```

This starts both:
- Backend API on `http://localhost:5001`
- Frontend dev server on `http://localhost:5173`

## User Roles

### 👤 Team Member
- Mark Office / Leave days for today → today + 90 days
- Remove markings (revert to WFH)
- View all team members' calendars
- Cannot edit past dates or others' entries

### 👑 Admin
- Everything a member can do, plus:
- Edit any user's entries (past or future)
- Manage users (create, edit, deactivate, delete)
- Manage public holidays

## API Endpoints

### Auth
| Method | Endpoint                | Description         |
|--------|-------------------------|---------------------|
| POST   | `/api/auth/register`    | Register new user   |
| POST   | `/api/auth/login`       | Login               |
| GET    | `/api/auth/me`          | Get current user    |
| PUT    | `/api/auth/profile`     | Update name         |
| PUT    | `/api/auth/change-password` | Change password |

### Entries
| Method | Endpoint                          | Description                    |
|--------|-----------------------------------|--------------------------------|
| GET    | `/api/entries?startDate&endDate`  | Get own entries                |
| GET    | `/api/entries/team?month=YYYY-MM` | Get team view for a month      |
| PUT    | `/api/entries`                    | Set/update own entry           |
| DELETE | `/api/entries/:date`              | Delete own entry (→ WFH)       |
| PUT    | `/api/entries/admin`              | Admin: set any user's entry    |
| DELETE | `/api/entries/admin/:userId/:date`| Admin: delete any user's entry |

### Admin
| Method | Endpoint                              | Description          |
|--------|---------------------------------------|----------------------|
| GET    | `/api/admin/users`                    | List all users       |
| POST   | `/api/admin/users`                    | Create user          |
| PUT    | `/api/admin/users/:id`                | Update user          |
| PUT    | `/api/admin/users/:id/reset-password` | Reset user password  |
| DELETE | `/api/admin/users/:id`                | Delete user          |

### Holidays
| Method | Endpoint                       | Description            |
|--------|--------------------------------|------------------------|
| GET    | `/api/holidays`                | Get holidays           |
| POST   | `/api/holidays`                | Create holiday (admin) |
| PUT    | `/api/holidays/:id`            | Update holiday (admin) |
| DELETE | `/api/holidays/:id`            | Delete holiday (admin) |

## Business Rules

1. **Default status is WFH** — no record needed
2. **Only `office` and `leave` are stored** in the database
3. **No approval workflow** — leave is for visibility only
4. **Planning window**: Today → Today + 90 days (members)
5. **Past dates are read-only** for members; admins can edit any date
6. **Full transparency** — every member can see everyone's calendar
7. **Holidays** appear on the calendar as non-editable special days
8. **Weekends** are greyed out and non-editable

## License

Internal use only.
