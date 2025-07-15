require('dotenv').config();
const express = require('express');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const swaggerSpecs = require('./swagger.config');
const cashuService = require('./services/cashu');
const lightningService = require('./services/lightning');
const redemptionService = require('./services/redemption');

const app = express();
const PORT = process.env.PORT || 3000;

// Get API domain for CORS configuration
const apiDomain = process.env.API_DOMAIN || 'localhost:3000';
const isProduction = process.env.NODE_ENV === 'production';
const protocol = isProduction ? 'https' : 'http';

// Middleware
app.use(express.json({ limit: '10mb' }));

// Enhanced CORS configuration for Swagger UI
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : [`${protocol}://${apiDomain}`],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With'],
  credentials: true,
  optionsSuccessStatus: 200
}));

// Additional middleware for Swagger UI preflight requests
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, X-Requested-With');
    res.status(200).end();
    return;
  }
  next();
});

// Debug endpoint to test CORS
app.get('/api/cors-test', (req, res) => {
  res.json({
    success: true,
    message: 'CORS test successful',
    timestamp: new Date().toISOString(),
    origin: req.headers.origin,
    host: req.headers.host
  });
});

// Swagger Documentation
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpecs, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Cashu Redeem API Documentation',
  swaggerOptions: {
    filter: true,
    showRequestHeaders: true,
    tryItOutEnabled: true
  }
}));

// Basic rate limiting (simple in-memory implementation)
const rateLimitMap = new Map();
const RATE_LIMIT = parseInt(process.env.RATE_LIMIT) || 100; // requests per minute

function rateLimit(req, res, next) {
  const clientId = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const windowStart = now - 60000; // 1 minute window

  if (!rateLimitMap.has(clientId)) {
    rateLimitMap.set(clientId, []);
  }

  const requests = rateLimitMap.get(clientId);
  
  // Remove old requests outside the window
  const validRequests = requests.filter(time => time > windowStart);
  rateLimitMap.set(clientId, validRequests);

  if (validRequests.length >= RATE_LIMIT) {
    return res.status(429).json({
      success: false,
      error: 'Rate limit exceeded. Please try again later.'
    });
  }

  validRequests.push(now);
  next();
}

// Apply rate limiting to all routes
app.use(rateLimit);

// Request logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`${timestamp} - ${req.method} ${req.path} - ${req.ip}`);
  next();
});

// Error handling middleware
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// API Routes

app.get('/', (req, res) => {
  res.json({
    name: 'Cashu Redeem API',
    version: '1.0.0',
    description: 'A production-grade API for redeeming Cashu tokens (ecash) to Lightning addresses using the cashu-ts library and LNURLp protocol',
    documentation: '/docs',
    endpoints: {
      decode: 'POST /api/decode',
      redeem: 'POST /api/redeem',
      validate: 'POST /api/validate-address',
      health: 'GET /api/health'
    },
    features: [
      'Decode Cashu tokens',
      'Redeem tokens to Lightning addresses',
      'Lightning address validation',
      'Domain restrictions',
      'Rate limiting',
      'Comprehensive error handling'
    ],
    github: 'https://github.com/yourusername/cashu-redeem-api'
  });
});

// API Routes

/**
 * @swagger
 * /api/decode:
 *   post:
 *     summary: Decode a Cashu token
 *     description: Decode a Cashu token and return its content. Supports both v1 and v3 token formats.
 *     tags: [Token Operations]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/DecodeRequest'
 *     responses:
 *       200:
 *         description: Token decoded successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DecodeResponse'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
app.post('/api/decode', asyncHandler(async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({
      success: false,
      error: 'Token is required'
    });
  }

  try {
    // Validate token format first
    if (!cashuService.isValidTokenFormat(token)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid token format. Must be a valid Cashu token'
      });
    }

    const decoded = await cashuService.parseToken(token);
    const mintUrl = await cashuService.getTokenMintUrl(token);
    
    // Check if token is spent
    let spent = false;
    try {
      const spendabilityCheck = await cashuService.checkTokenSpendable(token);
      // Token is spent if no proofs are spendable
      spent = !spendabilityCheck.spendable || spendabilityCheck.spendable.length === 0;
    } catch (error) {
      // If spendability check fails, analyze the error to determine if token is spent
      console.warn('Spendability check failed:', error.message);
      
      // Check if error indicates proofs are already spent
      const errorString = error.message || error.toString();
      
      // Check for specific error indicators
      if (errorString.includes('TOKEN_SPENT:')) {
        // CashuService has determined the token is spent based on clear indicators
        console.log('Token determined to be spent by CashuService');
        spent = true;
      } else if (errorString.includes('Token validation failed at mint:')) {
        // This is a 422 error but not clearly indicating the token is spent
        // It might be invalid/malformed but not necessarily spent
        console.log('Token validation failed at mint - assuming token is still valid (might be invalid format)');
        spent = false;
      } else if (errorString.includes('not supported') ||
                 errorString.includes('endpoint not found') ||
                 errorString.includes('may still be valid') ||
                 errorString.includes('does not support spendability checking')) {
        // Mint doesn't support spendability checking - assume token is still valid
        console.log('Mint does not support spendability checking - assuming token is valid');
        spent = false;
      } else {
        // For other errors (network, server issues), assume token is still valid
        // This is safer than assuming it's spent
        console.log('Unknown error - assuming token is valid');
        spent = false;
      }
    }
    
    res.json({
      success: true,
      decoded: {
        mint: decoded.mint,
        totalAmount: decoded.totalAmount,
        numProofs: decoded.numProofs,
        denominations: decoded.denominations,
        format: decoded.format,
        spent: spent
      },
      mint_url: mintUrl
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
}));

/**
 * @swagger
 * /api/redeem:
 *   post:
 *     summary: Redeem a Cashu token to Lightning address
 *     description: |
 *       Redeem a Cashu token to a Lightning address (optional - uses default if not provided).
 *       
 *       The redemption process includes:
 *       1. Token validation and parsing
 *       2. Getting exact melt quote from mint to determine precise fees
 *       3. Invoice creation for net amount (token amount - exact fees)
 *       4. Spendability checking at the mint
 *       5. Token melting and Lightning payment
 *       
 *       **Important**: The system gets the exact fee from the mint before creating the invoice.
 *       The `invoiceAmount` field shows the actual amount sent to the Lightning address.
 *       No sats are lost to fee estimation errors.
 *     tags: [Token Operations]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RedeemRequest'
 *     responses:
 *       200:
 *         description: Token redeemed successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/RedeemResponse'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       409:
 *         description: Token already spent
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: "This token has already been spent and cannot be redeemed again"
 *                 errorType:
 *                   type: string
 *                   example: "token_already_spent"
 *       422:
 *         description: Insufficient funds or unprocessable token
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: "Token amount is insufficient to cover the minimum fee"
 *                 errorType:
 *                   type: string
 *                   example: "insufficient_funds"
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
app.post('/api/redeem', asyncHandler(async (req, res) => {
  const { token, lightningAddress } = req.body;

  // Validate request (lightningAddress is now optional)
  const validation = await redemptionService.validateRedemptionRequest(token, lightningAddress);
  
  if (!validation.valid) {
    return res.status(400).json({
      success: false,
      error: validation.errors.join(', ')
    });
  }

  // Perform redemption
  try {
    const result = await redemptionService.performRedemption(token, lightningAddress);
    
    if (result.success) {
      const response = {
        success: true,
        paid: result.paid,
        amount: result.amount,
        invoiceAmount: result.invoiceAmount,
        to: result.to,
        fee: result.fee,
        actualFee: result.actualFee,
        netAmount: result.netAmount,
        mint_url: result.mint,
        format: result.format
      };

      // Include info about whether default address was used
      if (result.usingDefaultAddress) {
        response.usingDefaultAddress = true;
        response.message = `Redeemed to default Lightning address: ${result.to}`;
      }

      // Include preimage if available
      if (result.preimage) {
        response.preimage = result.preimage;
      }

      res.json(response);
    } else {
      // Determine appropriate status code based on error type
      let statusCode = 400;
      
      if (result.error && (
        result.error.includes('cannot be redeemed') ||
        result.error.includes('already been used') ||
        result.error.includes('not spendable') ||
        result.error.includes('already spent') ||
        result.error.includes('invalid proofs')
      )) {
        // Use 409 Conflict for already-spent tokens to distinguish from generic bad requests
        statusCode = 409;
      } else if (result.error && result.error.includes('insufficient')) {
        // Use 422 for insufficient funds
        statusCode = 422;
      }
      
      res.status(statusCode).json({
        success: false,
        error: result.error,
        errorType: statusCode === 409 ? 'token_already_spent' : 
                   statusCode === 422 ? 'insufficient_funds' : 'validation_error'
      });
    }
  } catch (error) {
    console.error('Error in redemption:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error during redemption'
    });
  }
}));

/**
 * @swagger
 * /api/health:
 *   get:
 *     summary: Health check endpoint
 *     description: |
 *       Check the health and status of the API server.
 *       Returns server information including uptime, memory usage, and version.
 *     tags: [Status & Monitoring]
 *     responses:
 *       200:
 *         description: Server is healthy
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HealthResponse'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
app.get('/api/health', asyncHandler(async (req, res) => {
  try {
    const packageJson = require('./package.json');
    
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      version: packageJson.version
    });
  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: 'Health check failed'
    });
  }
}));

/**
 * @swagger
 * /api/validate-address:
 *   post:
 *     summary: Validate a Lightning address
 *     description: |
 *       Validate a Lightning address without performing a redemption.
 *       Checks format validity and tests LNURLp resolution.
 *       
 *       Returns information about the Lightning address capabilities
 *       including min/max sendable amounts and comment allowance.
 *     tags: [Validation]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ValidateAddressRequest'
 *     responses:
 *       200:
 *         description: Validation completed (check 'valid' field for result)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ValidateAddressResponse'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
app.post('/api/validate-address', asyncHandler(async (req, res) => {
  const { lightningAddress } = req.body;

  if (!lightningAddress) {
    return res.status(400).json({
      success: false,
      error: 'Lightning address is required'
    });
  }

  try {
    const isValid = lightningService.validateLightningAddress(lightningAddress);
    
    if (!isValid) {
      return res.json({
        success: false,
        valid: false,
        error: 'Invalid Lightning address format'
      });
    }

    // Test resolution
    const { domain } = lightningService.parseLightningAddress(lightningAddress);
    const lnurlpUrl = lightningService.getLNURLpEndpoint(lightningAddress);
    
    try {
      const lnurlpResponse = await lightningService.fetchLNURLpResponse(lnurlpUrl);
      
      res.json({
        success: true,
        valid: true,
        domain,
        minSendable: lightningService.millisatsToSats(lnurlpResponse.minSendable),
        maxSendable: lightningService.millisatsToSats(lnurlpResponse.maxSendable),
        commentAllowed: lnurlpResponse.commentAllowed || 0
      });
    } catch (error) {
      res.json({
        success: false,
        valid: false,
        error: `Lightning address resolution failed: ${error.message}`
      });
    }
  } catch (error) {
    res.status(400).json({
      success: false,
      valid: false,
      error: error.message
    });
  }
}));

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
  });
});

// Global error handler
app.use((error, req, res, next) => {
  console.error('Global error handler:', error);
  
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({
      success: false,
      error: 'Invalid JSON payload'
    });
  }

  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// Cleanup old redemptions periodically (every hour)
setInterval(() => {
  try {
    redemptionService.cleanupOldRedemptions();
    console.log('Cleaned up old redemptions');
  } catch (error) {
    console.error('Error cleaning up redemptions:', error);
  }
}, 60 * 60 * 1000); // 1 hour

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Cashu Redeem API running on port ${PORT}`);
  console.log(`📖 API Documentation: http://localhost:${PORT}/docs`);
  console.log(`📍 Health check: http://localhost:${PORT}/api/health`);
  console.log(`🔒 Environment: ${process.env.NODE_ENV || 'development'}`);
  
  if (process.env.ALLOW_REDEEM_DOMAINS) {
    console.log(`🌐 Allowed domains: ${process.env.ALLOW_REDEEM_DOMAINS}`);
  } else {
    console.log('⚠️  No domain restrictions (ALLOW_REDEEM_DOMAINS not set)');
  }

  if (process.env.DEFAULT_LIGHTNING_ADDRESS) {
    console.log(`⚡ Default Lightning address: ${process.env.DEFAULT_LIGHTNING_ADDRESS}`);
  } else {
    console.log('⚠️  No default Lightning address configured - Lightning address will be required for redemptions');
  }
});

module.exports = app; 