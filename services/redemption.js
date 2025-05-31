const { v4: uuidv4 } = require('uuid');
const cashuService = require('./cashu');
const lightningService = require('./lightning');

class RedemptionService {
  constructor() {
    // In-memory storage for redemption status
    // In production, use Redis or a proper database
    this.redemptions = new Map();
    this.tokenHashes = new Map(); // Map token hashes to redemption IDs
  }

  /**
   * Generate a simple hash for a token (for duplicate detection)
   * @param {string} token - The Cashu token
   * @returns {string} Hash of the token
   */
  generateTokenHash(token) {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(token).digest('hex').substring(0, 16);
  }

  /**
   * Store redemption status
   * @param {string} redeemId - The redemption ID
   * @param {Object} status - The redemption status object
   */
  storeRedemption(redeemId, status) {
    this.redemptions.set(redeemId, {
      ...status,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }

  /**
   * Update redemption status
   * @param {string} redeemId - The redemption ID
   * @param {Object} updates - Updates to apply
   */
  updateRedemption(redeemId, updates) {
    const existing = this.redemptions.get(redeemId);
    if (existing) {
      this.redemptions.set(redeemId, {
        ...existing,
        ...updates,
        updatedAt: new Date().toISOString()
      });
    }
  }

  /**
   * Get redemption status by ID
   * @param {string} redeemId - The redemption ID
   * @returns {Object|null} Redemption status or null if not found
   */
  getRedemption(redeemId) {
    return this.redemptions.get(redeemId) || null;
  }

  /**
   * Get redemption ID by token hash
   * @param {string} tokenHash - The token hash
   * @returns {string|null} Redemption ID or null if not found
   */
  getRedemptionByTokenHash(tokenHash) {
    const redeemId = this.tokenHashes.get(tokenHash);
    return redeemId ? this.getRedemption(redeemId) : null;
  }

  /**
   * Check if a token has already been redeemed
   * @param {string} token - The Cashu token
   * @returns {Object|null} Existing redemption or null
   */
  checkExistingRedemption(token) {
    const tokenHash = this.generateTokenHash(token);
    return this.getRedemptionByTokenHash(tokenHash);
  }

  /**
   * Validate redemption request
   * @param {string} token - The Cashu token
   * @param {string} lightningAddress - The Lightning address (optional)
   * @returns {Object} Validation result
   */
  async validateRedemptionRequest(token, lightningAddress) {
    const errors = [];

    // Validate token format
    if (!token || typeof token !== 'string') {
      errors.push('Token is required and must be a string');
    }

    // Lightning address is now optional - we'll use default if not provided
    let addressToUse = null;
    try {
      addressToUse = lightningService.getLightningAddressToUse(lightningAddress);
      
      if (!lightningService.validateLightningAddress(addressToUse)) {
        errors.push('Invalid Lightning address format');
      }
    } catch (error) {
      errors.push(error.message);
    }

    // Check for existing redemption
    if (token) {
      const existing = this.checkExistingRedemption(token);
      if (existing) {
        errors.push('Token has already been redeemed');
      }
    }

    // Try to parse token
    let tokenData = null;
    if (token && errors.length === 0) {
      try {
        tokenData = await cashuService.parseToken(token);
        if (tokenData.totalAmount <= 0) {
          errors.push('Token has no value');
        }
      } catch (error) {
        errors.push(`Invalid token: ${error.message}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      tokenData,
      lightningAddressToUse: addressToUse
    };
  }

  /**
   * Perform the complete redemption process
   * @param {string} token - The Cashu token
   * @param {string} lightningAddress - The Lightning address (optional)
   * @returns {Object} Redemption result
   */
  async performRedemption(token, lightningAddress) {
    const redeemId = uuidv4();
    const tokenHash = this.generateTokenHash(token);

    try {
      // Determine which Lightning address to use
      const lightningAddressToUse = lightningService.getLightningAddressToUse(lightningAddress);
      const isUsingDefault = !lightningAddress || !lightningAddress.trim();

      // Store initial status
      this.storeRedemption(redeemId, {
        status: 'processing',
        token: token.substring(0, 50) + '...', // Store partial token for reference
        tokenHash,
        lightningAddress: lightningAddressToUse,
        usingDefaultAddress: isUsingDefault,
        amount: null,
        paid: false,
        error: null
      });

      // Also map token hash to redemption ID
      this.tokenHashes.set(tokenHash, redeemId);

      // Step 1: Parse and validate token
      this.updateRedemption(redeemId, { status: 'parsing_token' });
      const tokenData = await cashuService.parseToken(token);

      // Calculate expected fee according to NUT-05
      const expectedFee = cashuService.calculateFee(tokenData.totalAmount);
      
      // Calculate net amount after subtracting fees
      const netAmountAfterFee = tokenData.totalAmount - expectedFee;
      
      // Ensure we have enough for the minimum payment after fees
      if (netAmountAfterFee <= 0) {
        throw new Error(`Token amount (${tokenData.totalAmount} sats) is insufficient to cover the minimum fee (${expectedFee} sats)`);
      }

      this.updateRedemption(redeemId, { 
        amount: tokenData.totalAmount,
        mint: tokenData.mint,
        numProofs: tokenData.numProofs,
        expectedFee: expectedFee,
        netAmountAfterFee: netAmountAfterFee,
        format: tokenData.format
      });

      // Check if token is spendable
      this.updateRedemption(redeemId, { status: 'checking_spendability' });
      try {
        const spendabilityCheck = await cashuService.checkTokenSpendable(token);
        if (!spendabilityCheck.spendable || spendabilityCheck.spendable.length === 0) {
          throw new Error('Token proofs are not spendable - they have already been used or are invalid');
        }
      } catch (spendError) {
        // Check if the error indicates tokens are already spent (422 status)
        if (spendError.message.includes('not spendable') || 
            spendError.message.includes('already been used') ||
            spendError.message.includes('invalid proofs') ||
            spendError.message.includes('422')) {
          // This is likely an already-spent token - fail the redemption with clear message
          throw new Error('This token has already been spent and cannot be redeemed again');
        }
        // Log but don't fail for other errors - some mints might not support this check
        console.warn('Spendability check failed:', spendError.message);
      }

      // Step 2: Resolve Lightning address to invoice
      // IMPORTANT: Create invoice for net amount (after subtracting expected fees)
      this.updateRedemption(redeemId, { status: 'resolving_invoice' });
      const invoiceData = await lightningService.resolveInvoice(
        lightningAddressToUse, 
        netAmountAfterFee, // Use net amount instead of full token amount
        'Cashu redemption'
      );

      this.updateRedemption(redeemId, { 
        bolt11: invoiceData.bolt11.substring(0, 50) + '...',
        domain: invoiceData.domain,
        invoiceAmount: netAmountAfterFee
      });

      // Step 3: Melt the token to pay the invoice
      this.updateRedemption(redeemId, { status: 'melting_token' });
      const meltResult = await cashuService.meltToken(token, invoiceData.bolt11);

      // Log melt result for debugging
      console.log(`Redemption ${redeemId}: Melt result:`, {
        paid: meltResult.paid,
        hasPreimage: !!meltResult.preimage,
        amount: meltResult.amount,
        fee: meltResult.fee
      });

      // Determine if payment was successful
      // Consider it successful if we have a preimage, even if 'paid' flag is unclear
      const paymentSuccessful = meltResult.paid || !!meltResult.preimage;

      // Step 4: Update final status
      this.updateRedemption(redeemId, {
        status: paymentSuccessful ? 'paid' : 'failed',
        paid: paymentSuccessful,
        preimage: meltResult.preimage,
        fee: meltResult.fee,
        actualFee: meltResult.actualFee,
        netAmount: meltResult.netAmount,
        change: meltResult.change,
        paidAt: paymentSuccessful ? new Date().toISOString() : null,
        rawMeltResponse: meltResult.rawMeltResponse // Store for debugging
      });

      return {
        success: true,
        redeemId,
        paid: paymentSuccessful,
        amount: tokenData.totalAmount,
        invoiceAmount: netAmountAfterFee, // Amount actually sent in the invoice
        to: lightningAddressToUse,
        usingDefaultAddress: isUsingDefault,
        fee: meltResult.fee,
        actualFee: meltResult.actualFee,
        netAmount: meltResult.netAmount,
        preimage: meltResult.preimage,
        change: meltResult.change,
        mint: tokenData.mint,
        format: tokenData.format
      };

    } catch (error) {
      // Update redemption with error
      this.updateRedemption(redeemId, {
        status: 'failed',
        paid: false,
        error: error.message
      });

      return {
        success: false,
        redeemId,
        error: error.message
      };
    }
  }

  /**
   * Get redemption status for API response
   * @param {string} redeemId - The redemption ID
   * @returns {Object|null} Status response or null if not found
   */
  getRedemptionStatus(redeemId) {
    const redemption = this.getRedemption(redeemId);
    
    if (!redemption) {
      return null;
    }

    const response = {
      success: true,
      status: redemption.status,
      details: {
        amount: redemption.amount,
        to: redemption.lightningAddress,
        paid: redemption.paid,
        createdAt: redemption.createdAt,
        updatedAt: redemption.updatedAt
      }
    };

    if (redemption.paidAt) {
      response.details.paidAt = redemption.paidAt;
    }

    if (redemption.fee) {
      response.details.fee = redemption.fee;
    }

    if (redemption.error) {
      response.details.error = redemption.error;
    }

    if (redemption.mint) {
      response.details.mint = redemption.mint;
    }

    if (redemption.domain) {
      response.details.domain = redemption.domain;
    }

    return response;
  }

  /**
   * Get all redemptions (for admin/debugging)
   * @returns {Array} All redemptions
   */
  getAllRedemptions() {
    return Array.from(this.redemptions.entries()).map(([id, data]) => ({
      redeemId: id,
      ...data
    }));
  }

  /**
   * Clean up old redemptions (should be called periodically)
   * @param {number} maxAgeMs - Maximum age in milliseconds
   */
  cleanupOldRedemptions(maxAgeMs = 24 * 60 * 60 * 1000) { // 24 hours default
    const cutoff = new Date(Date.now() - maxAgeMs);
    
    for (const [redeemId, redemption] of this.redemptions.entries()) {
      const createdAt = new Date(redemption.createdAt);
      if (createdAt < cutoff) {
        this.redemptions.delete(redeemId);
        // Also clean up token hash mapping
        if (redemption.tokenHash) {
          this.tokenHashes.delete(redemption.tokenHash);
        }
      }
    }
  }
}

module.exports = new RedemptionService(); 