# 📱 Native Mobile App Integration Guide: Orders & Digital Stamp Loyalty

This document provides complete instructions, architecture, database models, business logic, and API contracts for implementing **Order Creation** and **Digital Stamp Loyalty Earning & Reward Claiming** in the native mobile application (iOS, Android, React Native).

> [!IMPORTANT]
> This guide is designed so you can implement the native mobile order and stamp earning flows using the existing endpoints **without modifying or breaking any dashboard logic**.

---

## 📑 Table of Contents
1. [End-to-End User & Data Flow](#1-end-to-end-user--data-flow)
2. [Database Models & Schema Context](#2-database-models--schema-context)
3. [Stamp Earning Rules & Logic](#3-stamp-earning-rules--logic)
4. [API Endpoints & Request/Response Contracts](#4-api-endpoints--requestresponse-contracts)
   - [4.1 Resolve Brand Stamp Info & Eligible Items](#41-resolve-brand-stamp-info--eligible-items)
   - [4.2 Create & Place Order](#42-create--place-order)
   - [4.3 Get Customer Wallet & Active Stamp Cards](#43-get-customer-wallet--active-stamp-cards)
   - [4.4 Get Eligible Purchased Reward Items](#44-get-eligible-purchased-reward-items)
   - [4.5 Generate Free Reward Coupon & QR](#45-generate-free-reward-coupon--qr)
5. [React Native UI & UX Implementation Guidelines](#5-react-native-ui--ux-implementation-guidelines)
6. [QR Code Specifications & Payload Types](#6-qr-code-specifications--payload-types)

---

## 1. End-to-End User & Data Flow

```
┌─────────────────────────┐      ┌─────────────────────────┐      ┌─────────────────────────┐
│ 1. BROWSE & CART        │ ──►  │ 2. PLACE ORDER          │ ──►  │ 3. EARN STAMPS          │
│ Fetch Brand Stamp Prog  │      │ Send order with items   │      │ Backend matches items   │
│ Display 'Stamp Eligible'│      │ to POST /api/app/orders │      │ against eligibleItemIds │
│ badge on menu items     │      │                         │      │ Wallet.stamps +qty      │
└─────────────────────────┘      └─────────────────────────┘      └────────────┬────────────┘
                                                                               │
                                                                               ▼
┌─────────────────────────┐      ┌─────────────────────────┐      ┌─────────────────────────┐
│ 6. REDEEM AT POS        │ ◄──  │ 5. GENERATE COUPON QR   │ ◄──  │ 4. STAMP CARD COMPLETE  │
│ Cashier scans Coupon QR │      │ Customer picks reward   │      │ When stamps >= target   │
│ Item discount 100% (0)  │      │ POST /generate-coupon   │      │ (e.g. 3/3 stamps),      │
│ Stamps reset to 0/3     │      │ Receives Coupon QR      │      │ Unlock "Claim Reward"   │
└─────────────────────────┘      └─────────────────────────┘      └─────────────────────────┘
```

---

## 2. Database Models & Schema Context

### 2.1 Brand Stamp Program (`Tenant.stampPrograms` & `Tenant.subStamps`)
Stored in the PostgreSQL `Tenant` table:
- `subStamps` (`Boolean`): Whether the brand has the digital stamp feature enabled by Super Admin.
- `stampPrograms` (`JSON Array`): Array of configured programs:
```json
[
  {
    "id": "stamp-prog-1",
    "nameEn": "Drinks & Desserts",
    "nameAr": "المشروبات والحلويات",
    "requiredStamps": 3,
    "cardBgColor": "#152329",
    "cardTextColor": "#FFFFFF",
    "rewardTextEn": "3 drinks and the 4th is free",
    "rewardTextAr": "٣ مشروبات والرابع مجاناً",
    "eligibleItemIds": [
      "a6a8d2d7-7c5c-4f4a-91d2-2b4f3da559f7",
      "39626ab9-2da2-4728-a367-d4abf37dc53c"
    ],
    "enabled": true
  }
]
```

### 2.2 Customer Wallet (`Wallet`)
```prisma
model Wallet {
  id           String   @id @default(uuid())
  appUserId    String
  tenantId     String?
  points       Int      @default(0)
  stamps       Int      @default(0)
  lifetimeEarn Float    @default(0.0)
  tier         String   @default("bronze")
}
```

### 2.3 Earned Reward Coupon (`EarnedCoupon`)
```prisma
model EarnedCoupon {
  id         String   @id @default(uuid())
  code       String   @unique // e.g. "STAMP-CAFE-A1B2C"
  prizeLabel String?  // e.g. "Free Spanish Latte (Stamp Reward)"
  tenantId   String
  appUserId  String
  menuItemId String?  // The specific menu item ID to apply 100% discount to
  isUsed     Boolean  @default(false)
  expiresAt  DateTime
}
```

---

## 3. Stamp Earning Rules & Logic

1. **Eligible Item Evaluation**:
   - An item earns a stamp if `stampProgram.enabled === true` AND:
     - `stampProgram.eligibleItemIds` contains `item.menuItemId`, OR
     - `stampProgram.eligibleItemIds` is empty / not set (meaning all menu items qualify).
   - **Stamp count earned = sum of quantities of eligible items in the order**.
   *(Example: Ordering 2 Iced Lattes and 1 Croissant where only Iced Latte is eligible earns **+2 stamps**)*.

2. **Stamp Accumulation & Overflow**:
   - Target stamps = `stampProgram.requiredStamps` (e.g. `3`).
   - If current stamps = `2` and customer earns `+1`, new total = `3/3` (Completed).
   - Stamps remain `3/3` until the reward is redeemed at POS checkout.

---

## 4. API Endpoints & Request/Response Contracts

### 4.1 Resolve Brand Stamp Info & Eligible Items
Use this when opening a brand or fetching the menu to identify which items are eligible for stamps.

- **Method**: `GET`
- **Endpoint**: `/api/app/stamp/info?tenantId={brandId}`
- **Auth**: Public / Optional Bearer Token
- **Response**:
```json
{
  "success": true,
  "data": {
    "brand": {
      "id": "c7e0b73c-4ba4-4c67-95d8-b03a1a84182d",
      "name": "Servi Cafe",
      "slug": "servi-cafe",
      "logoUrl": "https://api.servi.sa/uploads/brands/logo.png"
    },
    "stampProgram": {
      "id": "stamp-prog-1",
      "nameEn": "Drinks & Desserts",
      "nameAr": "المشروبات والحلويات",
      "requiredStamps": 3,
      "cardBgColor": "#152329",
      "cardTextColor": "#FFFFFF",
      "rewardTextEn": "3 drinks and the 4th is free",
      "rewardTextAr": "٣ مشروبات والرابع مجاناً",
      "eligibleItemIds": [
        "a6a8d2d7-7c5c-4f4a-91d2-2b4f3da559f7",
        "39626ab9-2da2-4728-a367-d4abf37dc53c"
      ],
      "enabled": true
    }
  }
}
```

---

### 4.2 Create & Place Order
Submits the order from the native cart.

- **Method**: `POST`
- **Endpoint**: `/api/app/orders`
- **Headers**: `Authorization: Bearer <CUSTOMER_JWT_TOKEN>`
- **Request Body**:
```json
{
  "tenantId": "c7e0b73c-4ba4-4c67-95d8-b03a1a84182d",
  "branchId": "b1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
  "type": "TAKEAWAY",
  "paymentMethod": "cash",
  "notes": "No sugar in coffee",
  "items": [
    {
      "menuItemId": "a6a8d2d7-7c5c-4f4a-91d2-2b4f3da559f7",
      "quantity": 2,
      "price": 18.00,
      "notes": "Extra ice"
    },
    {
      "menuItemId": "889102ab-1234-5678-9abc-def012345678",
      "quantity": 1,
      "price": 12.00
    }
  ]
}
```
- **Order Types Allowed**: `DINE_IN`, `TAKEAWAY`, `DELIVERY`, `DELIVER_TO_CAR`, `SCHEDULED`
- **Payment Methods Allowed**: `cash`, `card`, `apple_pay`, `points`

---

### 4.3 Get Customer Wallet & Active Stamp Cards
Retrieves the customer's current points balance, tier, and stamps count across all brands.

- **Method**: `GET`
- **Endpoint**: `/api/app/wallet`
- **Headers**: `Authorization: Bearer <CUSTOMER_JWT_TOKEN>`
- **Response**:
```json
{
  "success": true,
  "data": {
    "wallets": [
      {
        "tenantId": "c7e0b73c-4ba4-4c67-95d8-b03a1a84182d",
        "brandName": "Servi Cafe",
        "points": 140,
        "stamps": 3,
        "requiredStamps": 3,
        "stampProgram": {
          "nameEn": "Drinks & Desserts",
          "nameAr": "المشروبات والحلويات",
          "cardBgColor": "#152329",
          "cardTextColor": "#FFFFFF",
          "rewardTextEn": "3 drinks and the 4th is free",
          "rewardTextAr": "٣ مشروبات والرابع مجاناً"
        },
        "isStampCompleted": true
      }
    ]
  }
}
```

---

### 4.4 Get Eligible Purchased Reward Items
When the stamp card is complete (`3/3`), call this endpoint to list only the qualifying items the customer previously purchased so they can pick which one to claim for free.

- **Method**: `GET`
- **Endpoint**: `/api/app/stamp/eligible-items?customerId={customerId}&tenantId={tenantId}`
- **Response**:
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "a6a8d2d7-7c5c-4f4a-91d2-2b4f3da559f7",
        "name": "Spanish Latte",
        "description": "Rich espresso with sweetened condensed milk",
        "price": 22.00,
        "imageUrl": "/uploads/menus/latte.jpg"
      },
      {
        "id": "39626ab9-2da2-4728-a367-d4abf37dc53c",
        "name": "Chocolate Donut",
        "description": "Fresh glaze with Belgian chocolate",
        "price": 14.00,
        "imageUrl": "/uploads/menus/donut.jpg"
      }
    ],
    "rewardTextEn": "Free Stamp Reward",
    "rewardTextAr": "مكافأة الختم المجانية"
  }
}
```

---

### 4.5 Generate Free Reward Coupon & QR
Generates the single-use coupon and scannable QR payload for POS redemption.

- **Method**: `POST`
- **Endpoint**: `/api/app/stamp/generate-coupon`
- **Request Body**:
```json
{
  "customerId": "66753d3f-8e7d-4ccc-b0f2-bb36a1c3330f",
  "tenantId": "c7e0b73c-4ba4-4c67-95d8-b03a1a84182d",
  "menuItemId": "a6a8d2d7-7c5c-4f4a-91d2-2b4f3da559f7"
}
```
- **Response**:
```json
{
  "success": true,
  "data": {
    "coupon": {
      "id": "0df6409d-e63c-4868-bce0-579491eecd15",
      "code": "STAMP-SERVIC-CLAIM",
      "prizeLabel": "Free Spanish Latte (Stamp Reward)",
      "itemName": "Spanish Latte",
      "menuItemId": "a6a8d2d7-7c5c-4f4a-91d2-2b4f3da559f7",
      "expiresAt": "2026-10-30T17:35:35.476Z",
      "qrPayload": "{\"code\":\"STAMP-SERVIC-CLAIM\",\"tenantId\":\"c7e0b73c-4ba4-4c67-95d8-b03a1a84182d\",\"customerId\":\"66753d3f-8e7d-4ccc-b0f2-bb36a1c3330f\",\"menuItemId\":\"a6a8d2d7-7c5c-4f4a-91d2-2b4f3da559f7\",\"type\":\"COUPON\"}"
    }
  }
}
```

---

## 5. React Native UI & UX Implementation Guidelines

1. **Menu Item Badge**:
   - In menu list / item details, check `stampProgram.eligibleItemIds.includes(item.id)`.
   - If true, display a badge: `⭐ Earns Stamp`.
2. **Stamp Card Component**:
   - Render card background with `stampProgram.cardBgColor` and text with `stampProgram.cardTextColor`.
   - Render total circle slots equal to `requiredStamps`.
   - Circles up to `stamps` are **solid filled / checkmarked** ⭐. Remaining circles are **dashed outlines**.
3. **Completed Card State**:
   - When `stamps >= requiredStamps`, display an animated **"Claim Free Reward 🎉"** button.
   - On press, show a bottom-sheet modal calling `GET /api/app/stamp/eligible-items`.
   - When user taps an item and confirms, call `POST /api/app/stamp/generate-coupon`.
   - Render the returned `qrPayload` with `react-native-qrcode-svg` for the POS cashier to scan.

---

## 6. QR Code Specifications & Payload Types

| QR Code Type | Generated Where | Scanned By | Payload JSON Format |
|---|---|---|---|
| **Customer Stamp QR** | React Native Stamp Card | POS Cashier Scanner | `{"customerId":"...","phone":"+966...","tenantId":"...","type":"STAMP"}` |
| **Coupon Reward QR** | Native Claim Reward Modal | POS Cashier Scanner | `{"code":"STAMP-SERVIC-CLAIM","tenantId":"...","customerId":"...","menuItemId":"...","type":"COUPON"}` |
