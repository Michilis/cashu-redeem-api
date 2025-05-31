const swaggerJsdoc = require('swagger-jsdoc');

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
        url: 'http://localhost:3000',
        description: 'Development server'
      },
      {
        url: 'https://api.example.com',
        description: 'Production server'
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
              example: 'cashuAeyJwcm9vZnMiOlt7ImFtb3VudCI6MSwiaWQiOiIwMGZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmIn0seyJhbW91bnQiOjEsImlkIjoiMDBmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmIn1dLCJtaW50IjoiaHR0cHM6Ly9taW50LmV4YW1wbGUuY29tIn0'
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
              example: 'cashuAeyJwcm9vZnMiOlt7ImFtb3VudCI6MSwiaWQiOiIwMGZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmIn0seyJhbW91bnQiOjEsImlkIjoiMDBmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmIn1dLCJtaW50IjoiaHR0cHM6Ly9taW50LmV4YW1wbGUuY29tIn0'
            },
            lightningAddress: {
              type: 'string',
              format: 'email',
              description: 'Lightning address to send payment to (optional - uses default if not provided)',
              example: 'user@ln.tips'
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
            redeemId: {
              type: 'string',
              format: 'uuid',
              description: 'Unique redemption ID for tracking',
              example: '8e99101e-d034-4d2e-9ccf-dfda24d26762'
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
            change: {
              type: 'array',
              description: 'Change proofs returned (if any)',
              items: {
                type: 'object'
              },
              example: []
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
        
        // Status Schemas
        StatusRequest: {
          type: 'object',
          required: ['redeemId'],
          properties: {
            redeemId: {
              type: 'string',
              format: 'uuid',
              description: 'Redemption ID to check status for',
              example: '8e99101e-d034-4d2e-9ccf-dfda24d26762'
            }
          }
        },
        
        StatusResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: true
            },
            status: {
              type: 'string',
              enum: ['processing', 'parsing_token', 'checking_spendability', 'resolving_invoice', 'melting_token', 'paid', 'failed'],
              description: 'Current redemption status',
              example: 'paid'
            },
            details: {
              type: 'object',
              properties: {
                amount: {
                  type: 'integer',
                  description: 'Amount in satoshis',
                  example: 21000
                },
                to: {
                  type: 'string',
                  description: 'Lightning address',
                  example: 'user@ln.tips'
                },
                paid: {
                  type: 'boolean',
                  example: true
                },
                createdAt: {
                  type: 'string',
                  format: 'date-time',
                  example: '2025-01-14T11:59:30Z'
                },
                updatedAt: {
                  type: 'string',
                  format: 'date-time',
                  example: '2025-01-14T12:00:00Z'
                },
                paidAt: {
                  type: 'string',
                  format: 'date-time',
                  example: '2025-01-14T12:00:00Z'
                },
                fee: {
                  type: 'integer',
                  description: 'Fee charged in satoshis',
                  example: 1000
                },
                error: {
                  type: 'string',
                  description: 'Error message if failed',
                  example: null
                },
                mint: {
                  type: 'string',
                  format: 'uri',
                  description: 'Mint URL',
                  example: 'https://mint.azzamo.net'
                },
                domain: {
                  type: 'string',
                  description: 'Lightning address domain',
                  example: 'ln.tips'
                }
              }
            }
          }
        },
        
        // Health Schema
        HealthResponse: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              example: 'ok'
            },
            timestamp: {
              type: 'string',
              format: 'date-time',
              example: '2025-01-14T12:00:00Z'
            },
            uptime: {
              type: 'number',
              description: 'Server uptime in seconds',
              example: 3600
            },
            memory: {
              type: 'object',
              description: 'Memory usage information',
              example: {
                "rss": 45678912,
                "heapTotal": 12345678,
                "heapUsed": 8765432
              }
            },
            version: {
              type: 'string',
              example: '1.0.0'
            }
          }
        },
        
        // Stats Schema
        StatsResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: true
            },
            stats: {
              type: 'object',
              properties: {
                total: {
                  type: 'integer',
                  description: 'Total number of redemptions',
                  example: 150
                },
                paid: {
                  type: 'integer',
                  description: 'Number of successful redemptions',
                  example: 142
                },
                failed: {
                  type: 'integer',
                  description: 'Number of failed redemptions',
                  example: 8
                },
                processing: {
                  type: 'integer',
                  description: 'Number of currently processing redemptions',
                  example: 0
                },
                totalAmount: {
                  type: 'integer',
                  description: 'Total amount redeemed in satoshis',
                  example: 2500000
                },
                totalFees: {
                  type: 'integer',
                  description: 'Total fees collected in satoshis',
                  example: 15000
                }
              }
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
        
        // Check Spendable Schemas
        CheckSpendableRequest: {
          type: 'object',
          required: ['token'],
          properties: {
            token: {
              type: 'string',
              description: 'Cashu token to check spendability',
              example: 'cashuAeyJwcm9vZnMiOlt7ImFtb3VudCI6MSwiaWQiOiIwMGZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmIn0seyJhbW91bnQiOjEsImlkIjoiMDBmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmIn1dLCJtaW50IjoiaHR0cHM6Ly9taW50LmV4YW1wbGUuY29tIn0'
            }
          }
        },
        
        CheckSpendableResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: true
            },
            spendable: {
              type: 'array',
              items: {
                type: 'boolean'
              },
              description: 'Array indicating which proofs are spendable',
              example: [true, true, false]
            },
            pending: {
              type: 'array',
              items: {
                type: 'boolean'
              },
              description: 'Array indicating which proofs are pending',
              example: []
            },
            mintUrl: {
              type: 'string',
              format: 'uri',
              description: 'Mint URL where spendability was checked',
              example: 'https://mint.azzamo.net'
            },
            totalAmount: {
              type: 'integer',
              description: 'Total amount of the token in satoshis',
              example: 21000
            },
            message: {
              type: 'string',
              description: 'Human-readable status message',
              example: 'Token is spendable'
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
        name: 'Token Operations',
        description: 'Operations for decoding and redeeming Cashu tokens'
      },
      {
        name: 'Status & Monitoring',
        description: 'Endpoints for checking redemption status and API health'
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