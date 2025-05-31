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

      // Create melt quote to get fee estimate
      const meltQuote = await wallet.createMeltQuote(bolt11);
      
      // Calculate expected fee
      const expectedFee = this.calculateFee(parsed.totalAmount);
      
      // Check if we have sufficient funds including fees
      const totalRequired = meltQuote.amount + meltQuote.fee_reserve;
      if (totalRequired > parsed.totalAmount) {
        throw new Error(`Insufficient funds. Required: ${totalRequired} sats (including ${meltQuote.fee_reserve} sats fee), Available: ${parsed.totalAmount} sats`);
      }

      // Perform the melt operation using the quote and proofs
      const meltResponse = await wallet.meltTokens(meltQuote, proofs);

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
        actualFee: expectedFee, // Keep the calculated expected fee for comparison
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
      // Enhanced error logging
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
        console.log('HttpResponseError detected, extracting details...');
        
        // Try to extract useful information from the HTTP response error
        if (error.response) {
          const status = error.response.status || error.status;
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
          errorMessage = 'This mint does not support spendability checking or returned an invalid response';
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
      
      throw new Error(`Failed to check token spendability: ${errorMessage}`);
    }
  }
}

module.exports = new CashuService(); 