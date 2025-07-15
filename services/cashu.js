const { CashuMint, CashuWallet, getEncodedToken, getDecodedToken } = require('@cashu/cashu-ts');

class CashuService {
  constructor() {
    this.mints = new Map(); // Cache mint instances
    this.wallets = new Map(); // Cache wallet instances
  }

  /**
   * Validate token format (supports both v1 and v3 formats)
   * @param {string} token - The Cashu token
   * @returns {boolean} Whether the token format is valid
   */
  isValidTokenFormat(token) {
    // Match both v1 and v3 token formats
    return /^cashu[abAB][a-zA-Z0-9-_]+$/.test(token);
  }

  /**
   * Get token mint URL from decoded token
   * @param {string} token - The encoded Cashu token
   * @returns {string|null} Mint URL or null if not found
   */
  async getTokenMintUrl(token) {
    try {
      const decoded = getDecodedToken(token);
      if (!decoded) {
        return null;
      }

      // Handle both v1 and v3 token formats
      if (decoded.mint) {
        // v3 format
        return decoded.mint;
      } else if (decoded.token && decoded.token[0] && decoded.token[0].mint) {
        // v1 format
        return decoded.token[0].mint;
      }

      return null;
    } catch (error) {
      console.error('Error getting token mint URL:', error);
      return null;
    }
  }

  /**
   * Decode token handling both v1 and v3 formats
   * @param {string} token - The encoded Cashu token
   * @returns {Object} Decoded token data
   */
  async decodeTokenStructure(token) {
    try {
      const decoded = getDecodedToken(token);
      if (!decoded) {
        throw new Error('Failed to decode token');
      }

      // Handle both v1 and v3 token formats
      if (decoded.proofs) {
        // v3 format
        return {
          proofs: decoded.proofs,
          mint: decoded.mint
        };
      } else if (decoded.token && decoded.token[0]) {
        // v1 format
        return {
          proofs: decoded.token[0].proofs,
          mint: decoded.token[0].mint
        };
      }

      throw new Error('Invalid token structure');
    } catch (error) {
      throw new Error(`Token decoding failed: ${error.message}`);
    }
  }

  /**
   * Calculate fee according to NUT-05 specification
   * @param {number} amount - Amount in satoshis
   * @returns {number} Fee amount
   */
  calculateFee(amount) {
    // Calculate 2% of the amount, rounded up
    const fee = Math.ceil(amount * 0.02);
    // Return the greater of 1 sat or the calculated fee
    return Math.max(1, fee);
  }

  /**
   * Parse and validate a Cashu token
   * @param {string} token - The encoded Cashu token
   * @returns {Object} Parsed token data
   */
  async parseToken(token) {
    try {
      if (!token || typeof token !== 'string') {
        throw new Error('Invalid token format');
      }

      // Remove any whitespace and validate basic format
      token = token.trim();
      
      // Validate token format
      if (!this.isValidTokenFormat(token)) {
        throw new Error('Invalid token format. Must be a valid Cashu token');
      }

      // Decode token structure
      const decoded = await this.decodeTokenStructure(token);
      
      if (!decoded.proofs || !Array.isArray(decoded.proofs) || decoded.proofs.length === 0) {
        throw new Error('Invalid token structure - no proofs found');
      }

      // Calculate total amount
      const totalAmount = decoded.proofs.reduce((sum, proof) => sum + (proof.amount || 0), 0);
      
      if (totalAmount <= 0) {
        throw new Error('Token has no value');
      }

      const denominations = decoded.proofs.map(proof => proof.amount);

      return {
        mint: decoded.mint,
        totalAmount,
        numProofs: decoded.proofs.length,
        denominations,
        proofs: decoded.proofs,
        format: token.startsWith('cashuA') ? 'cashuA' : 'cashuB'
      };
    } catch (error) {
      throw new Error(`Token parsing failed: ${error.message}`);
    }
  }

  /**
   * Get total amount from a token
   * @param {string} token - The encoded Cashu token
   * @returns {number} Total amount in satoshis
   */
  async getTotalAmount(token) {
    const parsed = await this.parseToken(token);
    return parsed.totalAmount;
  }

  /**
   * Get or create a mint instance
   * @param {string} mintUrl - The mint URL
   * @returns {CashuMint} Mint instance
   */
  async getMint(mintUrl) {
    if (!this.mints.has(mintUrl)) {
      try {
        const mint = new CashuMint(mintUrl);
        // Test connectivity
        await mint.getInfo();
        this.mints.set(mintUrl, mint);
      } catch (error) {
        throw new Error(`Failed to connect to mint ${mintUrl}: ${error.message}`);
      }
    }
    return this.mints.get(mintUrl);
  }

  /**
   * Get or create a wallet instance for a specific mint
   * @param {string} mintUrl - The mint URL
   * @returns {CashuWallet} Wallet instance
   */
  async getWallet(mintUrl) {
    if (!this.wallets.has(mintUrl)) {
      try {
        const mint = await this.getMint(mintUrl);
        const wallet = new CashuWallet(mint);
        this.wallets.set(mintUrl, wallet);
      } catch (error) {
        throw new Error(`Failed to create wallet for mint ${mintUrl}: ${error.message}`);
      }
    }
    return this.wallets.get(mintUrl);
  }

  /**
   * Get melt quote for a Cashu token and Lightning invoice
   * @param {string} token - The encoded Cashu token
   * @param {string} bolt11 - The Lightning invoice
   * @returns {Object} Melt quote
   */
  async getMeltQuote(token, bolt11) {
    try {
      const parsed = await this.parseToken(token);
      const wallet = await this.getWallet(parsed.mint);

      // Create melt quote to get fee estimate
      const meltQuote = await wallet.createMeltQuote(bolt11);
      
      console.log('Melt quote created:', {
        amount: meltQuote.amount,
        fee_reserve: meltQuote.fee_reserve,
        quote: meltQuote.quote
      });
      
      return {
        amount: meltQuote.amount,
        fee_reserve: meltQuote.fee_reserve,
        quote: meltQuote.quote
      };
    } catch (error) {
      throw new Error(`Failed to get melt quote: ${error.message}`);
    }
  }

  /**
   * Melt a Cashu token to pay a Lightning invoice
   * @param {string} token - The encoded Cashu token
   * @param {string} bolt11 - The Lightning invoice
   * @returns {Object} Melt result
   */
  async meltToken(token, bolt11) {
    try {
      const parsed = await this.parseToken(token);
      const wallet = await this.getWallet(parsed.mint);

      // Get the decoded token structure
      const decoded = await this.decodeTokenStructure(token);
      const proofs = decoded.proofs;

      // Step 1: Create melt quote to get fee estimate
      const meltQuote = await wallet.createMeltQuote(bolt11);
      console.log('Melt quote created:', {
        amount: meltQuote.amount,
        fee_reserve: meltQuote.fee_reserve,
        quote: meltQuote.quote
      });
      console.log('Paying invoice:', bolt11.substring(0, 50) + '...');
      console.log('Full invoice being paid:', bolt11);
      
      // Step 2: Calculate total required (amount + fee_reserve)
      const total = meltQuote.amount + meltQuote.fee_reserve;
      console.log('Total required:', total, 'sats (amount:', meltQuote.amount, '+ fee:', meltQuote.fee_reserve, ')');
      console.log('Available in token:', parsed.totalAmount, 'sats');
      
      // Check if we have sufficient funds
      if (total > parsed.totalAmount) {
        throw new Error(`Insufficient funds. Required: ${total} sats (including ${meltQuote.fee_reserve} sats fee), Available: ${parsed.totalAmount} sats`);
      }

      // Step 3: Send tokens with includeFees: true to get the right proofs
      console.log('Selecting proofs with includeFees: true for', total, 'sats');
      const { send: proofsToSend } = await wallet.send(total, proofs, {
        includeFees: true,
      });
      console.log('Selected', proofsToSend.length, 'proofs for melting');

      // Step 4: Perform the melt operation using the quote and selected proofs
      console.log('Performing melt operation...');
      const meltResponse = await wallet.meltTokens(meltQuote, proofsToSend);

      // Debug: Log the melt response structure
      console.log('Melt response:', JSON.stringify(meltResponse, null, 2));

      // Verify payment was successful - check multiple possible indicators
      const paymentSuccessful = meltResponse.paid === true || 
                               meltResponse.payment_preimage || 
                               meltResponse.preimage ||
                               (meltResponse.state && meltResponse.state === 'PAID');

      if (!paymentSuccessful) {
        console.warn('Payment verification failed. Response structure:', meltResponse);
        // Don't throw error immediately - the payment might have succeeded
        // but the response structure is different than expected
      }

      // Get the actual fee charged from the melt response
      // The actual fee might be in meltResponse.fee_paid, meltResponse.fee, or calculated from change
      const actualFeeCharged = meltResponse.fee_paid || 
                               meltResponse.fee || 
                               meltQuote.fee_reserve; // fallback to quote fee

      // Calculate net amount based on actual fee charged
      const actualNetAmount = parsed.totalAmount - actualFeeCharged;

      return {
        success: true,
        paid: paymentSuccessful,
        preimage: meltResponse.payment_preimage || meltResponse.preimage,
        change: meltResponse.change || [],
        amount: meltQuote.amount,
        fee: actualFeeCharged, // Use actual fee from melt response
        netAmount: actualNetAmount, // Use net amount based on actual fee
        quote: meltQuote.quote,
        rawMeltResponse: meltResponse // Include raw response for debugging
      };
    } catch (error) {
      // Check if it's a cashu-ts specific error
      if (error.message.includes('Insufficient funds') || 
          error.message.includes('Payment failed') ||
          error.message.includes('Quote not found')) {
        throw error; // Re-throw specific cashu errors
      }
      
      // Check if it's an already-spent token error
      if (error.status === 422 || 
          error.message.includes('already spent') ||
          error.message.includes('not spendable') ||
          error.message.includes('invalid proofs')) {
        throw new Error('This token has already been spent and cannot be redeemed again');
      }
      
      throw new Error(`Melt operation failed: ${error.message}`);
    }
  }

  /**
   * Validate if a token is properly formatted and has valid proofs
   * @param {string} token - The encoded Cashu token
   * @returns {boolean} Whether the token is valid
   */
  async validateToken(token) {
    try {
      if (!this.isValidTokenFormat(token)) {
        return false;
      }
      
      const parsed = await this.parseToken(token);
      return parsed.totalAmount > 0 && parsed.proofs.length > 0;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get mint info for a given mint URL
   * @param {string} mintUrl - The mint URL
   * @returns {Object} Mint information
   */
  async getMintInfo(mintUrl) {
    try {
      const mint = await this.getMint(mintUrl);
      return await mint.getInfo();
    } catch (error) {
      throw new Error(`Failed to get mint info: ${error.message}`);
    }
  }

  /**
   * Check if proofs are spendable at the mint
   * @param {string} token - The encoded Cashu token
   * @returns {Object} Spendability check result
   */
  async checkTokenSpendable(token) {
    try {
      const parsed = await this.parseToken(token);
      const mint = await this.getMint(parsed.mint);
      
      // Extract secrets from proofs
      const secrets = parsed.proofs.map(proof => proof.secret);
      
      // Log the attempt for debugging
      console.log(`Checking spendability for ${secrets.length} proofs at mint: ${parsed.mint}`);
      
      // Perform the check
      const checkResult = await mint.check({ secrets });
      
      console.log('Spendability check result:', checkResult);
      
      return {
        spendable: checkResult.spendable || [],
        pending: checkResult.pending || [],
        mintUrl: parsed.mint,
        totalAmount: parsed.totalAmount
      };
    } catch (error) {
      // Enhanced error logging for debugging
      console.error('Spendability check error details:', {
        errorType: error.constructor.name,
        errorMessage: error.message,
        errorCode: error.code,
        errorStatus: error.status,
        errorResponse: error.response,
        errorData: error.data,
        errorStack: error.stack,
        errorString: String(error)
      });
      
      // Handle different types of errors
      let errorMessage = 'Unknown error occurred';
      
      // Handle cashu-ts HttpResponseError specifically
      if (error.constructor.name === 'HttpResponseError') {
        // Extract status code first
        const status = error.status || error.response?.status || error.statusCode;
        
        // For 422 errors, we need to be more specific about the reason
        if (status === 422) {
          // Try to get more details about the 422 error
          let responseBody = null;
          try {
            responseBody = error.response?.data || error.data || error.body;
            console.log('HTTP 422 response body:', responseBody);
          } catch (e) {
            console.log('Could not extract response body');
          }
          
          // 422 can mean different things, let's be more specific
          if (responseBody && typeof responseBody === 'object' && responseBody.detail) {
            errorMessage = `Token validation failed: ${responseBody.detail}`;
            console.log('422 error with detail:', responseBody.detail);
          } else {
            errorMessage = 'Token proofs are not spendable - they may have already been used or are invalid';
            console.log('Detected 422 status - token validation failed');
          }
        } else {
          // Try to extract useful information from the HTTP response error
          if (error.response) {
            const statusText = error.response.statusText;
            
            if (status === 404) {
              errorMessage = 'This mint does not support spendability checking (endpoint not found)';
            } else if (status === 405) {
              errorMessage = 'This mint does not support spendability checking (method not allowed)';
            } else if (status === 501) {
              errorMessage = 'This mint does not support spendability checking (not implemented)';
            } else {
              errorMessage = `Mint returned HTTP ${status}${statusText ? ': ' + statusText : ''}`;
            }
          } else if (error.message && error.message !== '[object Object]') {
            errorMessage = error.message;
          } else {
            // Try to extract error details from the error object structure
            console.log('Attempting to extract error details from object structure...');
            try {
              // Check if there's additional error data in the response
              const errorData = error.data || error.response?.data;
              if (errorData && typeof errorData === 'string') {
                errorMessage = errorData;
              } else if (errorData && errorData.detail) {
                errorMessage = `Mint error: ${errorData.detail}`;
              } else if (errorData && errorData.message) {
                errorMessage = `Mint error: ${errorData.message}`;
              } else {
                // Check if we can extract status from anywhere in the error
                if (status) {
                  if (status === 422) {
                    errorMessage = 'Token proofs are not spendable - they have already been used or are invalid';
                  } else {
                    errorMessage = `Mint returned HTTP ${status} - spendability checking may not be supported`;
                  }
                } else {
                  errorMessage = 'This mint does not support spendability checking or returned an invalid response';
                }
              }
            } catch (extractError) {
              console.log('Failed to extract error details:', extractError);
              errorMessage = 'This mint does not support spendability checking or returned an invalid response';
            }
          }
        }
      } else if (error && typeof error === 'object') {
        if (error.message && error.message !== '[object Object]') {
          errorMessage = error.message;
        } else if (error.toString && typeof error.toString === 'function') {
          const stringError = error.toString();
          if (stringError !== '[object Object]') {
            errorMessage = stringError;
          } else {
            errorMessage = 'Invalid response from mint - spendability checking may not be supported';
          }
        } else {
          errorMessage = 'Invalid response from mint - spendability checking may not be supported';
        }
      } else if (typeof error === 'string') {
        errorMessage = error;
      }
      
      // Log the final extracted error message for debugging
      console.log('Final extracted error message:', errorMessage);
      
      // Check if it's a known error pattern indicating unsupported operation
      if (errorMessage.includes('not supported') || 
          errorMessage.includes('404') ||
          errorMessage.includes('405') ||
          errorMessage.includes('501') ||
          errorMessage.includes('Method not allowed') ||
          errorMessage.includes('endpoint not found') ||
          errorMessage.includes('not implemented') ||
          errorMessage.includes('Invalid response from mint')) {
        throw new Error('This mint does not support spendability checking. Token may still be valid.');
      }
      
      // Check if the error indicates the token is spent (HTTP 422 or specific messages)
      const status = error.status || error.response?.status || error.statusCode;
      if (status === 422) {
        // For 422 errors, we need to be more careful about determining if it's "spent" vs "invalid"
        // Only mark as spent if we have clear indicators
        if (errorMessage.includes('already been used') || 
            errorMessage.includes('already spent') ||
            errorMessage.includes('not spendable')) {
          throw new Error('TOKEN_SPENT: Token proofs are not spendable - they have already been used');
        } else {
          // For other 422 errors, it might be invalid but not necessarily spent
          console.log('HTTP 422 but not clearly indicating spent token - treating as validation error');
          throw new Error(`Token validation failed at mint: ${errorMessage}`);
        }
      } else if (errorMessage.includes('Token proofs are not spendable') ||
                 errorMessage.includes('already been used') ||
                 errorMessage.includes('invalid proofs')) {
        throw new Error('TOKEN_SPENT: Token proofs are not spendable - they have already been used');
      }
      
      throw new Error(`Failed to check token spendability: ${errorMessage}`);
    }
  }
}

module.exports = new CashuService(); 