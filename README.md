# Invoice Management System - Server

This repository contains the backend server for the Invoice Management System, built with Node.js and Express. It handles user authentication, vendor management, invoice processing, and integrates with Stripe for subscription and payment functionalities.

## Features

*   **User Authentication:** Secure registration and login for admin and vendor roles using JWT.
*   **Vendor Management:** Admin functionalities to approve and manage vendor accounts.
*   **Invoice Processing:** API endpoints for creating and managing invoices.
*   **Stripe Integration:**
    *   Vendor subscriptions.
    *   Customer charging.
    *   Payout management for vendors.
*   **Analytics:** Admin dashboard analytics for overall system performance.
*   **Activity Logging:** Tracks key actions within the system.

## Technologies Used

*   **Node.js:** JavaScript runtime environment.
*   **Express.js:** Web application framework for Node.js.
*   **MongoDB:** NoSQL database.
*   **Mongoose:** ODM (Object Data Modeling) library for MongoDB and Node.js.
*   **Stripe API:** For handling payments and subscriptions.
*   **JWT (JSON Web Tokens):** For secure authentication.
*   **Bcrypt.js:** For password hashing.
*   **CORS:** Middleware for enabling Cross-Origin Resource Sharing.
*   **Dotenv:** For loading environment variables from a `.env` file.

## Development Information

### Prerequisites

*   Node.js (v18 or higher recommended)
*   MongoDB (local or cloud instance)

### Installation

1.  **Clone the repository:**
    ```bash
    git clone <your-repo-url>
    cd invoice-management-system/invoice-management-server
    ```
2.  **Install dependencies:**
    ```bash
    npm install
    ```

### Environment Variables

Create a `.env` file in the `invoice-management-server` directory with the following variables:

```
PORT=5000
MONGO_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret_key
STRIPE_SECRET_KEY=your_stripe_secret_key
STRIPE_WEBHOOK_SECRET=your_stripe_webhook_secret (if applicable)
ADMIN_USERNAME=your_admin_username
ADMIN_PASSWORD=your_admin_password
```

*   Replace `your_mongodb_connection_string` with your MongoDB connection URI.
*   Generate strong, random values for `your_jwt_secret_key`, `your_stripe_secret_key`, and `your_stripe_webhook_secret`.
*   Set `ADMIN_USERNAME` and `ADMIN_PASSWORD` for initial admin access.

### Running the Server

To start the development server (with `nodemon` for auto-restarts):

```bash
npm start
```

The server will typically run on `http://localhost:5000` (or the `PORT` specified in your `.env` file).

## API Endpoints (High-Level)

*   `/admin/*`: Admin-specific routes (login, vendor approval, analytics).
*   `/auth/*`: User authentication routes (register, login).
*   `/vendors/*`: Vendor-specific routes (profile, invoice creation, Stripe connect).
*   `/customers/*`: Customer-related routes (charging, invoice viewing).
*   `/stripe/*`: Webhook and other Stripe-related endpoints.

Please refer to the source code for detailed endpoint specifications and request/response formats.
