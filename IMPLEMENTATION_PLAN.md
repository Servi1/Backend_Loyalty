# Servio Backend — Implementation Plan

This document outlines the full implementation roadmap for the Servio backend.

---

## Technology Stack

| Layer              | Choice                         |
| :----------------- | :----------------------------- |
| Runtime            | Node.js                        |
| Language           | JavaScript (ES6+)              |
| Web Framework      | Express.js                     |
| Database           | PostgreSQL                     |
| ORM                | Prisma                         |
| Real-time          | Socket.io                      |
| Authentication     | JWT + OTP (Twilio)             |
| Authorization      | Role-Based Access Control      |

---

## Directory Structure

```
Backend_Loyalty/
├── prisma/
│   └── schema.prisma          # Database models & migrations
├── src/
│   ├── config/
│   │   ├── index.js           # Environment config
│   │   └── prisma.js          # Prisma client singleton
│   ├── features/
│   │   ├── auth/              # OTP + email/password login
│   │   │   ├── auth.routes.js
│   │   │   ├── auth.controller.js
│   │   │   └── auth.service.js
│   │   ├── tenants/           # Brand/Restaurant group management
│   │   │   ├── tenants.routes.js
│   │   │   ├── tenants.controller.js
│   │   │   └── tenants.service.js
│   │   ├── branches/          # Individual location management
│   │   │   ├── branches.routes.js
│   │   │   ├── branches.controller.js
│   │   │   └── branches.service.js
│   │   ├── menus/             # Categories & menu items
│   │   │   ├── menus.routes.js
│   │   │   ├── menus.controller.js
│   │   │   └── menus.service.js
│   │   ├── orders/            # Order lifecycle + real-time POS
│   │   │   ├── orders.routes.js
│   │   │   ├── orders.controller.js
│   │   │   └── orders.service.js
│   │   ├── loyalty/           # Wallet, points earn/redeem
│   │   │   ├── loyalty.routes.js
│   │   │   ├── loyalty.controller.js
│   │   │   └── loyalty.service.js
│   │   └── uploads/           # File upload handling
│   │       ├── uploads.routes.js
│   │       └── uploads.controller.js
│   ├── middlewares/
│   │   ├── authMiddleware.js  # JWT verification + role checks
│   │   ├── tenantMiddleware.js # Multi-tenant data isolation
│   │   ├── uploadMiddleware.js # Multer file upload config
│   │   └── errorHandler.js   # Global error handler
│   ├── socket/
│   │   └── index.js           # Socket.io room management
│   ├── utils/
│   │   ├── ApiError.js        # Custom error class
│   │   ├── catchAsync.js      # Async error wrapper
│   │   └── otp.js             # OTP generator
│   ├── app.js                 # Express app setup
│   └── server.js              # HTTP + Socket.io entry point
├── uploads/                   # Uploaded images (served statically)
│   ├── menus/
│   ├── logos/
│   └── avatars/
├── .env                       # Environment variables (gitignored)
├── .env.example               # Template for .env
├── .gitignore
└── package.json
```

---

## API Endpoints

### Auth (`/api/auth`)
| Method | Endpoint         | Access   | Description                      |
| :----- | :--------------- | :------- | :------------------------------- |
| POST   | `/otp/send`      | Public   | Send OTP to phone (Consumer App) |
| POST   | `/otp/verify`    | Public   | Verify OTP & get JWT             |
| POST   | `/login`         | Public   | Email/password login (B2B)       |
| GET    | `/me`            | Auth     | Get current user profile         |

### Tenants (`/api/tenants`)
| Method | Endpoint     | Access        | Description             |
| :----- | :----------- | :------------ | :---------------------- |
| GET    | `/`          | Admin         | List all tenants        |
| GET    | `/:id`       | Admin, Brand  | Get tenant details      |
| POST   | `/`          | Admin         | Create tenant           |
| PUT    | `/:id`       | Admin         | Update tenant           |
| DELETE | `/:id`       | Admin         | Delete tenant           |

### Branches (`/api/branches`)
| Method | Endpoint     | Access              | Description           |
| :----- | :----------- | :------------------ | :-------------------- |
| GET    | `/`          | Auth + Tenant       | List branches         |
| GET    | `/:id`       | Auth                | Get branch details    |
| POST   | `/`          | Admin, Brand        | Create branch         |
| PUT    | `/:id`       | Admin, Brand, Branch| Update branch         |
| DELETE | `/:id`       | Admin, Brand        | Delete branch         |

### Menus (`/api/menus`)
| Method | Endpoint              | Access              | Description              |
| :----- | :-------------------- | :------------------ | :----------------------- |
| GET    | `/categories`         | Public              | List menu categories     |
| GET    | `/items`              | Public + Tenant     | List items by tenant     |
| POST   | `/categories`         | Admin, Brand        | Create category          |
| POST   | `/items`              | Admin, Brand        | Create menu item         |
| PUT    | `/items/:id`          | Admin, Brand, Branch| Update menu item         |
| PATCH  | `/items/:id/toggle`   | Admin, Brand, Branch| Toggle availability      |
| DELETE | `/items/:id`          | Admin, Brand        | Delete menu item         |

### Orders (`/api/orders`)
| Method | Endpoint              | Access              | Description                          |
| :----- | :-------------------- | :------------------ | :----------------------------------- |
| POST   | `/`                   | Auth (Customer)     | Place a new order                    |
| GET    | `/mine`               | Auth (Customer)     | Get my order history                 |
| GET    | `/branch/:branchId`   | Staff               | Get orders for a branch              |
| PATCH  | `/:id/status`         | Staff               | Update order status (emits socket)   |

### Loyalty (`/api/loyalty`)
| Method | Endpoint     | Access         | Description               |
| :----- | :----------- | :------------- | :------------------------ |
| GET    | `/wallet`    | Auth           | Get my wallet & history   |
| POST   | `/earn`      | Staff          | Award points to a user    |
| POST   | `/redeem`    | Auth           | Redeem points             |

### Uploads (`/api/uploads`)
| Method | Endpoint                | Access              | Description                |
| :----- | :---------------------- | :------------------ | :------------------------- |
| POST   | `/menu`                 | Admin, Brand, Branch| Upload single menu image   |
| POST   | `/menu/bulk`            | Admin, Brand        | Upload up to 5 menu images |
| POST   | `/logo`                 | Admin, Brand        | Upload brand logo          |
| POST   | `/avatar`               | Auth                | Upload user avatar         |
| DELETE | `/:subDir/:filename`    | Admin, Brand, Branch| Delete an uploaded image   |

> **Static file access:** All uploaded images are served at `http://localhost:5000/uploads/<subDir>/<filename>`

---

## Database Models (Prisma)

**Core Models:** `User`, `Otp`, `Tenant`, `Branch`, `Table`, `MenuCategory`, `MenuItem`, `Order`, `OrderItem`, `Wallet`, `WalletTransaction`, `InventoryItem`

**Roles:** `ADMIN`, `BRAND_MANAGER`, `BRANCH_MANAGER`, `CASHIER`, `CUSTOMER`

---

## Real-time (Socket.io)

| Event              | Direction       | Description                                        |
| :----------------- | :-------------- | :------------------------------------------------- |
| `join:branch`      | Client → Server | Cashier joins their branch room                    |
| `join:user`        | Client → Server | Customer joins their personal room                 |
| `order:new`        | Server → Branch | Emitted when a new order is placed                 |
| `order:updated`    | Server → Branch | Emitted when order status changes                  |
| `order:status`     | Server → User   | Emitted to customer when their order status changes|

---

## Phases

### Phase 1 — Foundation ✅
- [x] Project scaffolding & dependencies
- [x] Prisma schema with all models
- [x] Auth (OTP + email/password)
- [x] CRUD for Tenants, Branches, Menus
- [x] Order creation & status lifecycle
- [x] Loyalty wallet (earn/redeem)
- [x] Socket.io real-time order flow
- [x] JWT auth + RBAC middleware
- [x] Local file uploads (menu images, logos, avatars) via Multer

### Phase 2 — Core Features (Remaining)
- [ ] **Tables CRUD** — Create/update/delete tables for a branch
- [ ] **QR Code Generation** — Auto-generate unique QR codes per table (using `qrcode` npm package), encode deep link URL `/t/:brandId/:tableId`
- [ ] **Reservation System** — `Reservation` model + CRUD (customer creates, branch confirms/rejects)
- [ ] **Staff Management** — Assign/remove staff to branches, manage roles per branch
- [ ] **Inventory Management** — CRUD for `InventoryItem`, low-stock alerts
- [ ] **App Design/Theming API** — Endpoint to save & retrieve `BrandTheme` config (colors, fonts, layout) per tenant
- [ ] **User Profile Update** — Update name, email, avatar for customers
- [ ] **Password Reset Flow** — Forgot password via email for B2B portal users
- [ ] **Search & Filtering** — Search menus by name, filter orders by status/date

### Phase 3 — Real-time & Notifications
- [ ] **Push Notifications** — Firebase Cloud Messaging (FCM) integration for order status updates to mobile
- [ ] **Live Table Status** — Socket.io events for table occupied/available status
- [ ] **Kitchen Display System** — Separate socket room for kitchen staff with prep-time tracking
- [ ] **Order Notifications Sound** — Socket event with audio alert payload for cashier incoming orders

### Phase 4 — Analytics & Reporting
- [ ] **EOD (End-of-Day) Reports** — Daily revenue, order count, avg ticket per branch
- [ ] **Brand Reports** — Cross-branch aggregated analytics for brand owners
- [ ] **Admin Dashboard Stats** — Platform-wide metrics (total orders, active tenants, revenue)
- [ ] **Loyalty Analytics** — Points issued vs. redeemed, top customers, retention metrics
- [ ] **Export Reports** — CSV/PDF export for financial reports

### Phase 5 — Billing & Subscriptions
- [ ] **Subscription Management** — Enforce feature limits per `SubscriptionTier` (FREE/STARTER/PRO/ENTERPRISE)
- [ ] **Payment Gateway Integration** — Stripe or similar for subscription billing
- [ ] **Invoice Generation** — Auto-generate monthly invoices for tenants
- [ ] **Usage Metering** — Track order volume per tenant for usage-based billing

### Phase 6 — Production Readiness
- [ ] **Input Validation** — Add `express-validator` or `Joi` on all endpoints
- [ ] **Rate Limiting** — Per-endpoint rate limits (especially OTP send)
- [ ] **Pagination** — Cursor/offset pagination on all list endpoints
- [ ] **Logging** — Structured logging with Winston or Pino
- [ ] **Automated Tests** — Unit tests (Jest) + API tests (Supertest)
- [ ] **CI/CD Pipeline** — GitHub Actions for lint, test, and deploy
- [ ] **Database Seeding** — Seed script with demo data for development
- [ ] **API Documentation** — Swagger/OpenAPI auto-generated docs
- [ ] **Security Hardening** — CSRF protection, input sanitization, SQL injection prevention via Prisma
