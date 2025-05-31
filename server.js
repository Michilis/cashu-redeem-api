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

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : ['http://localhost:3000'],
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Swagger Documentation
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpecs, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Cashu Redeem API Documentation',
  swaggerOptions: {
    filter: true,
    showRequestHeaders: true
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
    
    res.json({
      success: true,
      decoded: {
        mint: decoded.mint,
        totalAmount: decoded.totalAmount,
        numProofs: decoded.numProofs,
        denominations: decoded.denominations,
        format: decoded.format
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
 *       2. Spendability checking at the mint
 *       3. Lightning address resolution via LNURLp
 *       4. Token melting and Lightning payment
 *       
 *       Fee calculation follows NUT-05 specification (2% of amount, minimum 1 satoshi).
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
        redeemId: result.redeemId,
        paid: result.paid,
        amount: result.amount,
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

      // Include change if any
      if (result.change && result.change.length > 0) {
        response.change = result.change;
      }

      res.json(response);
    } else {
      res.status(400).json({
        success: false,
        error: result.error,
        redeemId: result.redeemId
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
 * /api/status:
 *   post:
 *     summary: Check redemption status by redeemId
 *     description: Check the current status of a redemption using its unique ID.
 *     tags: [Status & Monitoring]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/StatusRequest'
 *     responses:
 *       200:
 *         description: Status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StatusResponse'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
app.post('/api/status', asyncHandler(async (req, res) => {
  const { redeemId } = req.body;

  if (!redeemId) {
    return res.status(400).json({
      success: false,
      error: 'redeemId is required'
    });
  }

  const status = redemptionService.getRedemptionStatus(redeemId);
  
  if (!status) {
    return res.status(404).json({
      success: false,
      error: 'Redemption not found'
    });
  }

  res.json(status);
}));

/**
 * @swagger
 * /api/status/{redeemId}:
 *   get:
 *     summary: Check redemption status via URL parameter
 *     description: Same as POST /api/status but uses URL parameter - useful for frontend polling.
 *     tags: [Status & Monitoring]
 *     parameters:
 *       - in: path
 *         name: redeemId
 *         required: true
 *         description: Unique redemption ID to check status for
 *         schema:
 *           type: string
 *           format: uuid
 *           example: '8e99101e-d034-4d2e-9ccf-dfda24d26762'
 *     responses:
 *       200:
 *         description: Status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StatusResponse'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
app.get('/api/status/:redeemId', asyncHandler(async (req, res) => {
  const { redeemId } = req.params;

  const status = redemptionService.getRedemptionStatus(redeemId);
  
  if (!status) {
    return res.status(404).json({
      success: false,
      error: 'Redemption not found'
    });
  }

  res.json(status);
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
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: require('./package.json').version
  });
});

/**
 * @swagger
 * /api/stats:
 *   get:
 *     summary: Get redemption statistics
 *     description: |
 *       Get comprehensive statistics about redemptions (admin endpoint).
 *       Returns information about total redemptions, success rates, amounts, and fees.
 *       
 *       **Note**: In production, this endpoint should be protected with authentication.
 *     tags: [Status & Monitoring]
 *     responses:
 *       200:
 *         description: Statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StatsResponse'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
app.get('/api/stats', asyncHandler(async (req, res) => {
  // In production, add authentication here
  const stats = redemptionService.getStats();
  
  res.json({
    success: true,
    stats
  });
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

/**
 * @swagger
 * /api/check-spendable:
 *   post:
 *     summary: Check if Cashu token is spendable
 *     description: |
 *       Check if a Cashu token is spendable at its mint before attempting redemption.
 *       This is a pre-validation step that can save time and prevent failed redemptions.
 *       
 *       Returns an array indicating which proofs within the token are spendable,
 *       pending, or already spent.
 *     tags: [Validation]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CheckSpendableRequest'
 *     responses:
 *       200:
 *         description: Spendability check completed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CheckSpendableResponse'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
app.post('/api/check-spendable', asyncHandler(async (req, res) => {
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

    const spendabilityCheck = await cashuService.checkTokenSpendable(token);
    
    res.json({
      success: true,
      spendable: spendabilityCheck.spendable,
      pending: spendabilityCheck.pending,
      mintUrl: spendabilityCheck.mintUrl,
      totalAmount: spendabilityCheck.totalAmount,
      message: spendabilityCheck.spendable && spendabilityCheck.spendable.length > 0 
        ? 'Token is spendable' 
        : 'Token proofs are not spendable - may have already been used'
    });
  } catch (error) {
    res.status(400).json({
      success: false,
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