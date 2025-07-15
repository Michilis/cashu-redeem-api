require('dotenv').config();
const swaggerJsdoc = require('swagger-jsdoc');

// Get the API domain from environment variable, default to localhost:3000
const apiDomain = process.env.API_DOMAIN || 'localhost:3000';
const isProduction = process.env.NODE_ENV === 'production';
const protocol = isProduction ? 'https' : 'http';

// For production behind Nginx, we need to ensure the URL doesn't include the internal port
const serverUrl = isProduction 
  ? `${protocol}://${apiDomain}` 
  : `${protocol}://${apiDomain}`;

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Cashu Redeem API',
      version: '1.0.0',
      description: 'A production-grade API for redeeming Cashu tokens (ecash) to Lightning addresses using the cashu-ts library and LNURLp protocol.',
      contact: {
        name: 'API Support',
        email: 'support@example.com'
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT'
      }
    },
    servers: [
      {
        url: serverUrl,
        description: isProduction ? 'Production server' : 'Development server'
      }
    ],
    components: {
      schemas: {
        // Error Response Schema
        ErrorResponse: {
          type: 'object',
          required: ['success', 'error'],
          properties: {
            success: {
              type: 'boolean',
              example: false
            },
            error: {
              type: 'string',
              example: 'Error message description'
            }
          }
        },
        
        // Token Decode Schemas
        DecodeRequest: {
          type: 'object',
          required: ['token'],
          properties: {
            token: {
              type: 'string',
              description: 'Cashu token to decode (supports v1 and v3 formats)',
              example: 'cashuB...'
            }
          }
        },
        
        DecodeResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: true
            },
            decoded: {
              type: 'object',
              properties: {
                mint: {
                  type: 'string',
                  format: 'uri',
                  example: 'https://mint.azzamo.net'
                },
                totalAmount: {
                  type: 'integer',
                  description: 'Total amount in satoshis',
                  example: 21000
                },
                numProofs: {
                  type: 'integer',
                  description: 'Number of proofs in the token',
                  example: 3
                },
                denominations: {
                  type: 'array',
                  items: {
                    type: 'integer'
                  },
                  description: 'Array of proof amounts',
                  example: [1000, 10000, 10000]
                },
                format: {
                  type: 'string',
                  enum: ['cashuA', 'cashuB'],
                  description: 'Token format version',
                  example: 'cashuA'
                },
                spent: {
                  type: 'boolean',
                  description: 'Whether the token has already been spent (true = spent, false = still valid)',
                  example: false
                }
              }
            },
            mint_url: {
              type: 'string',
              format: 'uri',
              description: 'Mint URL extracted from token',
              example: 'https://mint.azzamo.net'
            }
          }
        },
        
        // Redeem Schemas
        RedeemRequest: {
          type: 'object',
          required: ['token'],
          properties: {
            token: {
              type: 'string',
              description: 'Cashu token to redeem',
              example: 'cashuB...'
            },
            lightningAddress: {
              type: 'string',
              format: 'email',
              description: 'Lightning address to send payment to (optional - uses default if not provided)',
              example: 'user@blink.sv'
            }
          }
        },
        
        RedeemResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: true
            },
            paid: {
              type: 'boolean',
              description: 'Whether the payment was successful',
              example: true
            },
            amount: {
              type: 'integer',
              description: 'Total amount redeemed in satoshis',
              example: 21000
            },
            invoiceAmount: {
              type: 'integer',
              description: 'Actual amount sent in Lightning invoice (after subtracting fees)',
              example: 20580
            },
            to: {
              type: 'string',
              description: 'Lightning address that received the payment',
              example: 'user@ln.tips'
            },
            fee: {
              type: 'integer',
              description: 'Actual fee charged by mint in satoshis',
              example: 1000
            },
            actualFee: {
              type: 'integer',
              description: 'Calculated fee according to NUT-05 (2% min 1 sat)',
              example: 420
            },
            netAmount: {
              type: 'integer',
              description: 'Net amount after fees in satoshis',
              example: 20000
            },
            mint_url: {
              type: 'string',
              format: 'uri',
              description: 'Mint URL used for redemption',
              example: 'https://mint.azzamo.net'
            },
            format: {
              type: 'string',
              enum: ['cashuA', 'cashuB'],
              description: 'Token format that was redeemed',
              example: 'cashuA'
            },
            preimage: {
              type: 'string',
              description: 'Lightning payment preimage (if available)',
              example: 'abc123def456...'
            },
            usingDefaultAddress: {
              type: 'boolean',
              description: 'Whether default Lightning address was used',
              example: false
            },
            message: {
              type: 'string',
              description: 'Additional message (when using default address)',
              example: 'Redeemed to default Lightning address: admin@example.com'
            }
          }
        },
        
        // Validate Address Schemas
        ValidateAddressRequest: {
          type: 'object',
          required: ['lightningAddress'],
          properties: {
            lightningAddress: {
              type: 'string',
              format: 'email',
              description: 'Lightning address to validate',
              example: 'user@ln.tips'
            }
          }
        },
        
        ValidateAddressResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: true
            },
            valid: {
              type: 'boolean',
              example: true
            },
            domain: {
              type: 'string',
              example: 'ln.tips'
            },
            minSendable: {
              type: 'integer',
              description: 'Minimum sendable amount in satoshis',
              example: 1
            },
            maxSendable: {
              type: 'integer',
              description: 'Maximum sendable amount in satoshis',
              example: 100000000
            },
            commentAllowed: {
              type: 'integer',
              description: 'Maximum comment length allowed',
              example: 144
            },
            error: {
              type: 'string',
              description: 'Error message if validation failed',
              example: null
            }
          }
        },
        
        HealthResponse: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              example: 'OK'
            },
            message: {
              type: 'string',
              example: 'API is healthy'
            }
          }
        }
      },
      
      responses: {
        BadRequest: {
          description: 'Bad request - invalid input',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/ErrorResponse'
              }
            }
          }
        },
        NotFound: {
          description: 'Resource not found',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/ErrorResponse'
              }
            }
          }
        },
        InternalServerError: {
          description: 'Internal server error',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/ErrorResponse'
              }
            }
          }
        },
        TooManyRequests: {
          description: 'Rate limit exceeded',
          content: {
            'application/json': {
              schema: {
                allOf: [
                  { $ref: '#/components/schemas/ErrorResponse' },
                  {
                    properties: {
                      error: {
                        example: 'Rate limit exceeded. Please try again later.'
                      }
                    }
                  }
                ]
              }
            }
          }
        }
      }
    },
    tags: [
      {
        name: 'General',
        description: 'General API information and utilities'
      },
      {
        name: 'Token Operations',
        description: 'Operations for decoding and redeeming Cashu tokens'
      },
      {
        name: 'Validation',
        description: 'Validation utilities for tokens and Lightning addresses'
      }
    ]
  },
  apis: ['./server.js'], // paths to files containing OpenAPI definitions
};

const specs = swaggerJsdoc(options);
module.exports = specs; 