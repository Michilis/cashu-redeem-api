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

      // Verify payment was successful
      if (!meltResponse.paid) {
        throw new Error('Payment failed - token melted but Lightning payment was not successful');
      }

      return {
        success: true,
        paid: meltResponse.paid,
        preimage: meltResponse.payment_preimage,
        change: meltResponse.change || [],
        amount: meltQuote.amount,
        fee: meltQuote.fee_reserve,
        actualFee: expectedFee,
        netAmount: parsed.totalAmount - meltQuote.fee_reserve,
        quote: meltQuote.quote
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
      
      const secrets = parsed.proofs.map(proof => proof.secret);
      const checkResult = await mint.check({ secrets });
      
      return {
        spendable: checkResult.spendable,
        pending: checkResult.pending || [],
        mintUrl: parsed.mint,
        totalAmount: parsed.totalAmount
      };
    } catch (error) {
      throw new Error(`Failed to check token spendability: ${error.message}`);
    }
  }
}

module.exports = new CashuService(); 