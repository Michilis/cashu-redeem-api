# Cashu Redeem API 🪙⚡

A production-grade API for redeeming Cashu tokens (ecash) to Lightning addresses using the cashu-ts library and LNURLp protocol.

## 🚀 Features

- **Decode Cashu tokens** - Parse and validate token content
- **Redeem to Lightning addresses** - Convert ecash to Lightning payments via LNURLp
- **Security features** - Domain restrictions, rate limiting, input validation
- **Robust error handling** - Comprehensive error messages
- **In-memory caching** - Fast mint and wallet instances with connection pooling
- **Interactive API Documentation** - Complete Swagger/OpenAPI documentation at `/docs`


## 📖 API Documentation

**Interactive Swagger Documentation**: Visit `/docs` when running the server for a complete, interactive API reference.

Example: `https://cashu-redeem.azzamo.net/docs/`

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
  "token": "cashuB..."
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
    "format": "cashuA",
    "spent": false
  },
  "mint_url": "https://mint.azzamo.net"
}
```

### 2. `POST /api/redeem`
Redeem a Cashu token to a Lightning address. Lightning address is optional - if not provided, uses the default address from configuration.

**Request:**
```json
{
  "token": "cashuB...",
  "lightningAddress": "user@ln.tips"
}
```

**Request (using default address):**
```json
{
  "token": "cashuB..."
}
```

**Success Response:**
```json
{
  "success": true,
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


**Payment Verification**: 
The API uses multiple indicators to verify payment success:
- `paid` flag from mint response
- Presence of payment preimage
- Payment state indicators

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

### 4. `GET /api/health`
Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-01-14T12:00:00Z",
  "uptime": 3600,
  "memory": {...},
  "version": "1.0.0"
}
```

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
- Manages redemption status tracking
- Handles duplicate token detection

### Data Flow

1. **Token Validation** - Parse and validate Cashu token structure
2. **Address Resolution** - Resolve Lightning address to LNURLp endpoint
3. **Invoice Generation** - Create Lightning invoice for the amount
4. **Token Melting** - Use cashu-ts to melt token and pay invoice

## 🔒 Security Features

- **Input validation** - All inputs are sanitized and validated
- **Rate limiting** - 100 requests per minute per IP (configurable)
- **Domain restrictions** - Limit allowed Lightning address domains
- **CORS protection** - Configurable allowed origins
- **Error handling** - Comprehensive error messages without data leaks

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

```bash
curl http://localhost:3000/api/health
```

### Logs
The server logs all requests and errors to console. In production, consider using a proper logging solution like Winston.

## 🧪 Testing

### Interactive Testing with Swagger

The easiest way to test the API is using the interactive Swagger documentation at `/docs`:
- Visit `http://localhost:3000/docs` 
- Click "Try it out" on any endpoint
- Fill in the request parameters
- Execute the request directly from the browser

### Example cURL commands

**Decode a token:**
```bash
curl -X POST http://localhost:3000/api/decode \
  -H "Content-Type: application/json" \
  -d '{"token":"your-cashu-token-here"}'
```

**Redeem a token to specific address:**
```bash
curl -X POST http://localhost:3000/api/redeem \
  -H "Content-Type: application/json" \
  -d '{
    "token": "your-cashu-token-here",
    "lightningAddress": "user@ln.tips"
  }'
```

**Redeem a token to default address:**
```bash
curl -X POST http://localhost:3000/api/redeem \
  -H "Content-Type: application/json" \
  -d '{
    "token": "your-cashu-token-here"
  }'
```

## 🚀 Production Deployment

### Recommendations

1. **Use a process manager** (PM2, systemd)
2. **Set up reverse proxy** (nginx, Apache)
3. **Enable HTTPS** with SSL certificates
4. **Use Redis** for persistent storage instead of in-memory
5. **Set up monitoring** (Prometheus, Grafana)
6. **Configure logging** (Winston, structured logs)
7. **Set resource limits** and health checks


## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📝 License

MIT License - see LICENSE file for details.