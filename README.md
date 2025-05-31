# Cashu Redeem API 🪙⚡

A production-grade API for redeeming Cashu tokens (ecash) to Lightning addresses using the cashu-ts library and LNURLp protocol.

## 🚀 Features

- **Decode Cashu tokens** - Parse and validate token content
- **Redeem to Lightning addresses** - Convert ecash to Lightning payments via LNURLp
- **Real-time status tracking** - Monitor redemption progress with unique IDs
- **Security features** - Domain restrictions, rate limiting, input validation
- **Robust error handling** - Comprehensive error messages and status codes
- **In-memory caching** - Fast mint and wallet instances with connection pooling
- **Interactive API Documentation** - Complete Swagger/OpenAPI documentation at `/docs`

## 📖 API Documentation

**Interactive Swagger Documentation**: Visit `/docs` when running the server for a complete, interactive API reference.

Example: `http://localhost:3000/docs`

The documentation includes:
- Complete endpoint specifications
- Request/response schemas
- Try-it-out functionality
- Example requests and responses
- Authentication requirements
- Error code documentation

## 📡 API Endpoints

### 1. `POST /api/decode`
Decode a Cashu token and return its content. Supports both v1 and v3 token formats.

**Request:**
```json
{
  "token": "cashuAeyJhbGciOi..."
}
```

**Response:**
```json
{
  "success": true,
  "decoded": {
    "mint": "https://mint.azzamo.net",
    "totalAmount": 21000,
    "numProofs": 3,
    "denominations": [1000, 10000, 10000],
    "format": "cashuA"
  },
  "mint_url": "https://mint.azzamo.net"
}
```

### 2. `POST /api/redeem`
Redeem a Cashu token to a Lightning address. Lightning address is optional - if not provided, uses the default address from configuration.

**Request:**
```json
{
  "token": "cashuAeyJhbGciOi...",
  "lightningAddress": "user@ln.tips"
}
```

**Request (using default address):**
```json
{
  "token": "cashuAeyJhbGciOi..."
}
```

**Success Response:**
```json
{
  "success": true,
  "redeemId": "8e99101e-d034-4d2e-9ccf-dfda24d26762",
  "paid": true,
  "amount": 21000,
  "invoiceAmount": 20580,
  "to": "user@ln.tips",
  "fee": 1000,
  "actualFee": 420,
  "netAmount": 20000,
  "mint_url": "https://mint.azzamo.net",
  "format": "cashuA",
  "preimage": "abc123..."
}
```

**Success Response (using default address):**
```json
{
  "success": true,
  "redeemId": "8e99101e-d034-4d2e-9ccf-dfda24d26762",
  "paid": true,
  "amount": 21000,
  "invoiceAmount": 20580,
  "to": "admin@your-domain.com",
  "fee": 1000,
  "actualFee": 420,
  "netAmount": 20000,
  "mint_url": "https://mint.azzamo.net",
  "format": "cashuA",
  "usingDefaultAddress": true,
  "message": "Redeemed to default Lightning address: admin@your-domain.com"
}
```

**Important Note on Fees**: 
- Fees are calculated according to NUT-05 (2% of token amount, minimum 1 satoshi)
- **Fees are subtracted from the token amount before creating the Lightning invoice**
- `amount`: Original token amount
- `invoiceAmount`: Actual amount sent to Lightning address (amount - expected fees)
- `fee`: Actual fee charged by the mint
- `actualFee`: Calculated expected fee
- `netAmount`: Final amount after all deductions

**Payment Verification**: 
The API uses multiple indicators to verify payment success:
- `paid` flag from mint response
- Presence of payment preimage
- Payment state indicators

If you receive a "payment failed" error but the Lightning payment was successful, use the debug endpoint to investigate the raw mint response.

### 3. `POST /api/validate-address`
Validate a Lightning address without redemption.

**Request:**
```json
{
  "lightningAddress": "user@ln.tips"
}
```

**Response:**
```json
{
  "success": true,
  "valid": true,
  "domain": "ln.tips",
  "minSendable": 1,
  "maxSendable": 100000000,
  "commentAllowed": 144
}
```

### 4. `POST /api/check-spendable`
Check if a Cashu token is spendable at its mint before attempting redemption.

**Request:**
```json
{
  "token": "cashuAeyJhbGciOi..."
}
```

**Success Response:**
```json
{
  "success": true,
  "spendable": [true, true, false],
  "pending": [],
  "mintUrl": "https://mint.azzamo.net",
  "totalAmount": 21000,
  "spendableCount": 2,
  "totalProofs": 3,
  "message": "2 of 3 token proofs are spendable"
}
```

**Response (when mint doesn't support spendability checking):**
```json
{
  "success": true,
  "supported": false,
  "message": "This mint does not support spendability checking. Token format appears valid.",
  "error": "This mint does not support spendability checking. Token may still be valid."
}
```

**Fallback Response (when spendability check fails but token is valid):**
```json
{
  "success": true,
  "supported": false,
  "fallback": true,
  "mintUrl": "https://21mint.me",
  "totalAmount": 21000,
  "totalProofs": 8,
  "message": "Spendability check failed, but token format is valid. Token may still be usable.",
  "error": "Failed to check token spendability: [error details]"
}
```

**Note**: Some mints may not support spendability checking. In such cases, the endpoint will return `supported: false` with a success status, indicating that while the check couldn't be performed, the token format itself appears valid.

## 🛠 Setup & Installation

### Prerequisites
- Node.js >= 18.0.0
- npm or yarn

### Installation

1. **Clone and install dependencies:**
```bash
git clone <your-repo>
cd cashu-redeem-api
npm install
```

2. **Setup environment variables:**
```bash
cp env.example .env
```

Edit `.env` file:
```bash
# Server Configuration
PORT=3000
NODE_ENV=development

# Security Configuration
ALLOW_REDEEM_DOMAINS=ln.tips,getalby.com,wallet.mutinywallet.com
API_SECRET=your-secret-key-here

# Default Lightning Address (used when no address is provided in redeem requests)
DEFAULT_LIGHTNING_ADDRESS=admin@your-domain.com

# Rate Limiting (requests per minute)
RATE_LIMIT=100

# CORS Configuration
ALLOWED_ORIGINS=http://localhost:3000,https://yourdomain.com
```

3. **Start the server:**
```bash
# Development
npm run dev

# Production
npm start
```

The API will be available at `http://localhost:3000`

## 🔧 Configuration

### Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `PORT` | Server port | `3000` | No |
| `NODE_ENV` | Environment | `development` | No |
| `ALLOW_REDEEM_DOMAINS` | Comma-separated allowed domains | All allowed | No |
| `DEFAULT_LIGHTNING_ADDRESS` | Default Lightning address for redemptions | None | No |
| `RATE_LIMIT` | Requests per minute per IP | `100` | No |
| `ALLOWED_ORIGINS` | CORS allowed origins | `http://localhost:3000` | No |

### Domain Restrictions

To restrict redemptions to specific Lightning address domains, set:
```bash
ALLOW_REDEEM_DOMAINS=ln.tips,getalby.com,wallet.mutinywallet.com
```

If not set, all domains are allowed.

### Default Lightning Address

To set a default Lightning address that will be used when no address is provided in redemption requests:
```bash
DEFAULT_LIGHTNING_ADDRESS=admin@your-domain.com
```

This allows users to redeem tokens without specifying a Lightning address - the tokens will automatically be sent to your configured default address. If no default is set, Lightning address becomes required for all redemption requests.

## 🏗 Architecture

### Services

#### `services/cashu.js`
- Manages Cashu token parsing and validation
- Handles mint connections and wallet instances
- Performs token melting operations
- Caches mint/wallet connections for performance

#### `services/lightning.js`
- Validates Lightning address formats
- Resolves LNURLp endpoints
- Generates Lightning invoices
- Handles domain restrictions

#### `services/redemption.js`
- Coordinates the complete redemption process
- Manages redemption status tracking
- Handles duplicate token detection
- Provides cleanup functionality

### Data Flow

1. **Token Validation** - Parse and validate Cashu token structure
2. **Address Resolution** - Resolve Lightning address to LNURLp endpoint
3. **Invoice Generation** - Create Lightning invoice for the amount
4. **Token Melting** - Use cashu-ts to melt token and pay invoice
5. **Status Tracking** - Store and update redemption status with UUID

## 🔒 Security Features

- **Input validation** - All inputs are sanitized and validated
- **Rate limiting** - 100 requests per minute per IP (configurable)
- **Domain restrictions** - Limit allowed Lightning address domains
- **CORS protection** - Configurable allowed origins
- **Error handling** - Comprehensive error messages without data leaks
- **Token deduplication** - Prevent double-spending with hash tracking

## 🚦 Status Codes

| Status | Description |
|--------|-------------|
| `processing` | Redemption is in progress |
| `parsing_token` | Validating and parsing the token |
| `resolving_invoice` | Resolving Lightning address to invoice |
| `melting_token` | Performing the melt operation |
| `paid` | Successfully paid and completed |
| `failed` | Redemption failed (see error details) |

## 📊 Monitoring

### Health Check
```