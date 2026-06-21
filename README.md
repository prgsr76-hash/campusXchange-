# CampusXchange

CampusXchange is a full-stack student-to-student marketplace designed specifically for college campuses. It allows students to buy, sell, rent, exchange, and donate items (textbooks, calculators, cycles, electronics, lab gear, hostel essentials, sports equipment, etc.) within a trusted local campus network.

The frontend is styled with **premium, AJIO-inspired retail aesthetics**, featuring sliding promotional carousels, responsive category roundels, full filter sidebar tools, dynamic badges, product detailed views, and an interactive seller dashboard.

---

## Technical Stack

* **Frontend**: HTML5, CSS3 (Vanilla Custom Properties, Flexbox, Grid), JavaScript (ES6+ SPA Engine).
* **Backend**: Node.js, Express.js (Modular Router & Controller architecture).
* **Database**: MongoDB (via Mongoose schemas) with **Local Persistent JSON database fallback**.
* **Authentication**: JSON Web Tokens (JWT) with cookies/headers and `bcryptjs` hashing.
* **Storage**: Cloudinary API with **local file uploads fallback**.

---

## Key Features

1. **AJIO-Style User Interface**: Highly responsive e-commerce aesthetics including an auto-sliding promo banner, interactive category roundels, filtering toggles, and detail view cards.
2. **User Authentication**: Secure student registration, logins, and session persistence. Validates hostel locations and emails.
3. **Marketplace Listings**: List items under discrete categories with different transaction models (Sell, Rent, Exchange, Donate) and prices.
4. **Image Upload Engine**: Upload pictures of products. Automatically uploads to Cloudinary if keys are present, else writes directly to local storage.
5. **Interactive Filters**: Dynamic searching, category routing, price range bounding, transaction filtering, and location matching.
6. **Student Dashboard**: Sellers can monitor active listings, mark items as Sold/Rented/Donated, edit parameters, and delete listings.

---

## Quick Start (Zero-Configuration Fallback Mode)

CampusXchange includes an out-of-the-box fallback engine. If you do not have MongoDB or Cloudinary keys, the application automatically uses a local JSON file database and disk storage uploads.

### 1. Install Dependencies
```bash
npm install
```

### 2. Start the Server
```bash
npm start
```
*The server will run on `http://localhost:5000` using the local persistent database (`db_fallback.json`) and local upload folder (`public/uploads`).*

---

## Running in Production Mode (MongoDB & Cloudinary)

To activate MongoDB database connectivity and Cloudinary uploads:

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
2. Populate the parameters in `.env`:
   - Set `MONGO_URI` to your MongoDB Atlas connection string.
   - Set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` to your Cloudinary access keys.
3. Restart the server. The console will print `MongoDB Connected Successfully` and `Cloudinary storage engine configured successfully.`

---

## API Documentation

### Authentication Routes
* `POST /api/auth/register` - Create student account.
* `POST /api/auth/login` - Authenticate credentials and return JWT token.
* `GET /api/auth/me` - Retrieve current session's profile info (Private).

### Marketplace Listing Routes
* `GET /api/listings` - Read listings. Supports filters: `?search=`, `?category=`, `?transactionType=`, `?status=`, `?owner=`.
* `GET /api/listings/:id` - Read single item details.
* `POST /api/listings` - Publish listing (Private).
* `PUT /api/listings/:id` - Edit listing fields or update status (Private, Owner only).
* `DELETE /api/listings/:id` - Remove listing (Private, Owner only).

### Image Upload Route
* `POST /api/upload` - Upload item photo (Private). Returns JSON `{ imageUrl: "..." }`.
