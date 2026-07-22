# Servi POS — Point of Sale API Documentation

> **Base URL:** `/api/pos/`  
> **Purpose:** Handles all cashier terminal operations — catalog browsing, order management, EOD reports, and cash drawer sessions.

---

## Middleware

### `authenticatePos` — `middlewares/posMiddleware.js`
Single combined middleware that handles **tenant resolution + authentication + role authorization** for every POS request.

**Steps:**
1. Extracts tenant from `x-tenant-id` header → `req.params.tenantId` → `?tenantId` query
2. Looks up tenant in main DB (by id or slug), verifies `isActive`
3. Attaches `req.tenantId`, `req.tenant`, `req.tenantDb`
4. Extracts JWT token from `Authorization: Bearer ...` header or `?token` query param
5. Looks up user in **tenant DB** — must exist
6. Enforces role: `CASHIER` or `BRAND_MANAGER`
7. Blocks access if branch is deactivated (unless `BRAND_MANAGER`)

**Attaches:** `req.user`, `req.tenantDb`, `req.tenantId`, `req.tenant`

**Errors:**
| Status | Reason |
|--------|--------|
| 400 | Missing tenant ID |
| 404 | Tenant not found or inactive |
| 401 | Missing / invalid / expired token |
| 401 | Cashier user no longer exists |
| 403 | Only Cashiers can access POS endpoints |
| 403 | Branch currently deactivated |

> **Note:** Token can also be passed as `?token=...` in query string (for WebSocket or QR-based sessions).

---

## Route Map

All routes are applied after `authenticatePos`:

```
GET    /catalog                    → menu catalog
GET    /tables                     → active tables for cashier's branch
GET    /orders                     → orders (optionally filtered by status)
POST   /orders                     → create new order
PATCH  /orders/:id/status          → update order status

GET    /reports/eod                → EOD report (JSON)
GET    /reports/eod/download       → EOD report (PDF download)

GET    /cashdrawer/status          → current open session
GET    /cashdrawer/sessions        → all sessions for branch
POST   /cashdrawer/open            → open a new session
POST   /cashdrawer/close           → close active session
```

---

## Catalog

### 1. Get Menu Catalog — `GET /catalog`
Returns all menu categories with their available items. Used to build the POS item grid.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "...", "name": "Burgers", "order": 1,
      "items": [{ "id": "...", "name": "Classic Burger", "price": 35.0, "imageUrl": "https://..." }]
    }
  ]
}
```

**Notes:** Items filtered to `isAvailable: true`, sorted by name. Image URLs resolved to absolute URLs.

---

## Tables

### 2. Get Tables — `GET /tables`
Returns active tables for the cashier's branch (derived from `req.user.branchId`).

**Response:**
```json
{ "success": true, "data": [{ "id": "...", "label": "T1", "seats": 4, "zone": "Main", "isActive": true }] }
```

---

## Orders

### 3. Get Orders — `GET /orders`
Returns all orders for the cashier's branch, enriched with customer profile data.

**Query:**
```
?status=PENDING   // optional filter — PENDING | ACCEPTED | PREPARING | READY | COMPLETED | CANCELLED
```

**Logic:**
- Fetches orders from tenant DB with items, table, and cashier info
- Enriches each order with `customer` from main DB (for app-placed orders with a `customerId`)

**Response:** Array of orders with `items`, `table`, `user`, `customer`.

---

### 4. Create Order — `POST /orders`
Creates a new POS order. Prices are trusted from the POS client (cashier-controlled).

**Body:**
```json
{
  "type": "DINE_IN",              // DINE_IN | TAKEAWAY | DELIVERY
  "tableId": "...",               // optional
  "notes": "Extra spicy",
  "paymentMethod": "cash",        // cash | card | points | apple_pay | google_pay
  "customerPhone": "+966...",     // optional
  "customerId": "...",            // optional — links to app user for loyalty
  "customOrderTypeId": "...",     // optional
  "status": "ACCEPTED",           // default: ACCEPTED
  "total": 75.5,
  "items": [
    { "menuItemId": "...", "quantity": 2, "price": 35.0, "notes": "no onions", "selectedModifiers": [...] }
  ]
}
```

**Logic:**
1. Validates at least one item exists
2. Generates unique `ORD-XXXXXX` order number (retries up to 10 times for uniqueness)
3. Creates order in tenant DB
4. Syncs to aggregated orders in main DB (async)
5. Awards loyalty points to customer if `customerId` is set and status is not `HALTED`

**Response:** `201` — full order with items and table.

**Errors:**
| Status | Reason |
|--------|--------|
| 400 | Order must contain at least one item |

---

### 5. Update Order Status — `PATCH /orders/:id/status`
Updates an order's status.

**Params:** `:id` — order ID

**Body:**
```json
{ "status": "PREPARING", "paymentMethod": "card" }
```

**Valid statuses:** `HALTED` → `PENDING` → `ACCEPTED` → `PREPARING` → `READY` → `COMPLETED` / `CANCELLED`

**Transition rules:**
- `ACCEPTED` can only be set from `PENDING` or `HALTED`

**Side effects:**
- Syncs status to main DB order record
- If `HALTED → ACCEPTED`: awards loyalty points (delayed earn)
- If `COMPLETED`: awards loyalty points if not already earned and not a points payment
- Syncs to aggregated orders (async)

**Errors:**
| Status | Reason |
|--------|--------|
| 400 | Invalid status value |
| 400 | Transition rule violation |
| 404 | Order not found |

---

## EOD Reports

### 6. Get EOD Report — `GET /reports/eod`
Returns an end-of-day sales report in JSON for the cashier's branch.

**Query:**
```
?date=2026-07-17   // required, YYYY-MM-DD
```

**Logic:**
- Queries `ACCEPTED | PREPARING | READY | COMPLETED` orders for the day
- Compares to previous day for sales growth %
- Groups payments by `cash`, `card`, `mobile`
- Calculates top 5 selling items by quantity

**Response:**
```json
{
  "success": true,
  "data": {
    "branchName": "Main Branch",
    "date": "2026-07-17",
    "totalSales": 1250.00,
    "totalOrders": 38,
    "avgOrder": 32.89,
    "salesGrowth": 12.5,
    "payments": [
      { "methodKey": "cash", "amount": 800.00 },
      { "methodKey": "card", "amount": 350.00 },
      { "methodKey": "mobile", "amount": 100.00 }
    ],
    "topItems": [
      { "itemKey": "classicburger", "name": "Classic Burger", "quantity": 24, "revenue": 840.00 }
    ]
  }
}
```

**Errors:** `400` if `date` query param is missing.

---

### 7. Download EOD Report PDF — `GET /reports/eod/download`
Same as above but streams a formatted **PDF** file.

**Headers returned:**
```
Content-Type: application/pdf
Content-Disposition: attachment; filename=EOD-Report-2026-07-17.pdf
```

**PDF Sections:**
- Header banner (branch name, date, currency)
- Summary cards: Total Sales, Total Transactions, Average Transaction
- Payment Breakdown rows
- Top Selling Products table
- Footer with cashier name and generation timestamp

---

## Cash Drawer

### 8. Get Cash Drawer Status — `GET /cashdrawer/status`
Returns the currently open cash drawer session for the cashier's branch, including live expected balance and transaction log.

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "...", "status": "OPEN", "openingBalance": 500,
    "expectedSales": 1250.00, "expectedEndingBalance": 1750.00,
    "openedAt": "...", "openedBy": {...},
    "transactions": [{ "id": "...", "type": "in", "description": "#ORD-123456", "amount": 35.0, "time": "10:45 AM" }]
  }
}
```

Returns `null` if no session is open.

---

### 9. Get All Cash Drawer Sessions — `GET /cashdrawer/sessions`
Returns all past and active sessions for the cashier's branch, ordered newest first.

---

### 10. Open Cash Drawer Session — `POST /cashdrawer/open`
Opens a new cash drawer session.

**Body:**
```json
{ "openingBalance": 500 }
```

**Logic:** Blocks if a session is already open for this branch.

**Response:** `201` — created session object.

**Errors:**
| Status | Reason |
|--------|--------|
| 400 | A session is already open for this branch |

---

### 11. Close Cash Drawer Session — `POST /cashdrawer/close`
Closes the active cash drawer session and records discrepancy.

**Body:**
```json
{
  "sessionId": "...",
  "actualEndingBalance": 1700.00,
  "cashCounts": { "1": 10, "5": 20, "10": 5 }   // optional denomination counts
}
```

**Logic:**
1. Loads session, validates it's not already closed
2. Calculates `expectedSales` from all cash orders since session open
3. Computes `discrepancy = actualEnding - expectedEnding`
4. Saves transaction log with all cash orders from the shift

**Response:** Updated session with `discrepancy`, `expectedSales`, `actualEndingBalance`, `closedAt`.

**Errors:**
| Status | Reason |
|--------|--------|
| 404 | Session not found |
| 400 | Session already closed |

---

## Notes

- All POS routes use the cashier's `branchId` from `req.user.branchId` — no branch param needed
- Loyalty points are awarded at order **creation** (not completion) unless status is `HALTED`, in which case they're awarded when status moves to `ACCEPTED`
- Order numbers follow the `ORD-XXXXXX` format (6-digit random suffix)
- EOD reports use **local server time** for date filtering
- Aggregated order syncs to the main DB are fire-and-forget (non-blocking); errors are logged
- `selectedModifiers` on order items are stored as a JSON string in the DB
