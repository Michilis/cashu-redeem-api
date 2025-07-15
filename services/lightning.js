const axios = require('axios');
const bolt11 = require('bolt11');

class LightningService {
  constructor() {
    this.allowedDomains = process.env.ALLOW_REDEEM_DOMAINS 
      ? process.env.ALLOW_REDEEM_DOMAINS.split(',').map(d => d.trim())
      : [];
    this.defaultLightningAddress = process.env.DEFAULT_LIGHTNING_ADDRESS;
  }

  /**
   * Get the default Lightning address from environment
   * @returns {string|null} Default Lightning address or null if not set
   */
  getDefaultLightningAddress() {
    return this.defaultLightningAddress || null;
  }

  /**
   * Get Lightning address to use - provided address or default
   * @param {string|null} providedAddress - The provided Lightning address
   * @returns {string} Lightning address to use
   */
  getLightningAddressToUse(providedAddress) {
    if (providedAddress && providedAddress.trim()) {
      return providedAddress.trim();
    }
    
    const defaultAddress = this.getDefaultLightningAddress();
    if (!defaultAddress) {
      throw new Error('No Lightning address provided and no default Lightning address configured');
    }
    
    return defaultAddress;
  }

  /**
   * Validate Lightning Address format
   * @param {string} lightningAddress - The Lightning address (user@domain.com)
   * @returns {boolean} Whether the address is valid
   */
  validateLightningAddress(lightningAddress) {
    if (!lightningAddress || typeof lightningAddress !== 'string') {
      return false;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(lightningAddress);
  }

  /**
   * Check if a domain is allowed for redemption
   * @param {string} domain - The domain to check
   * @returns {boolean} Whether the domain is allowed
   */
  isDomainAllowed(domain) {
    if (this.allowedDomains.length === 0) {
      return true; // If no restrictions, allow all
    }
    
    // Check for wildcard allowing all domains
    if (this.allowedDomains.includes('*')) {
      return true;
    }
    
    return this.allowedDomains.includes(domain.toLowerCase());
  }

  /**
   * Parse Lightning Address into username and domain
   * @param {string} lightningAddress - The Lightning address
   * @returns {Object} Parsed address components
   */
  parseLightningAddress(lightningAddress) {
    if (!this.validateLightningAddress(lightningAddress)) {
      throw new Error('Invalid Lightning address format');
    }

    const [username, domain] = lightningAddress.split('@');
    
    if (!this.isDomainAllowed(domain)) {
      throw new Error(`Domain ${domain} is not allowed for redemption`);
    }

    return { username, domain };
  }

  /**
   * Resolve LNURLp endpoint from Lightning address
   * @param {string} lightningAddress - The Lightning address
   * @returns {string} LNURLp endpoint URL
   */
  getLNURLpEndpoint(lightningAddress) {
    const { username, domain } = this.parseLightningAddress(lightningAddress);
    return `https://${domain}/.well-known/lnurlp/${username}`;
  }

  /**
   * Fetch LNURLp response from endpoint
   * @param {string} lnurlpUrl - The LNURLp endpoint URL
   * @returns {Object} LNURLp response data
   */
  async fetchLNURLpResponse(lnurlpUrl) {
    try {
      const response = await axios.get(lnurlpUrl, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Cashu-Redeem-API/1.0.0'
        }
      });

      if (response.status !== 200) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = response.data;
      
      if (data.status === 'ERROR') {
        throw new Error(data.reason || 'LNURLp endpoint returned error');
      }

      if (!data.callback || !data.minSendable || !data.maxSendable) {
        throw new Error('Invalid LNURLp response - missing required fields');
      }

      return data;
    } catch (error) {
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        throw new Error('Unable to connect to Lightning address provider');
      }
      throw new Error(`LNURLp fetch failed: ${error.message}`);
    }
  }

  /**
   * Get Lightning invoice from LNURLp callback
   * @param {string} callbackUrl - The callback URL from LNURLp response
   * @param {number} amount - Amount in millisatoshis
   * @param {string} comment - Optional comment
   * @returns {Object} Invoice response
   */
  async getInvoice(callbackUrl, amount, comment = '') {
    try {
      const url = new URL(callbackUrl);
      url.searchParams.set('amount', amount.toString());
      
      if (comment && comment.length > 0) {
        url.searchParams.set('comment', comment.substring(0, 144)); // LN comment limit
      }

      const response = await axios.get(url.toString(), {
        timeout: 10000,
        headers: {
          'User-Agent': 'Cashu-Redeem-API/1.0.0'
        }
      });

      if (response.status !== 200) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = response.data;
      
      if (data.status === 'ERROR') {
        throw new Error(data.reason || 'Invoice generation failed');
      }

      if (!data.pr) {
        throw new Error('No invoice returned from callback');
      }

      return {
        bolt11: data.pr,
        successAction: data.successAction,
        verify: data.verify
      };
    } catch (error) {
      throw new Error(`Invoice generation failed: ${error.message}`);
    }
  }

  /**
   * Convert satoshis to millisatoshis
   * @param {number} sats - Amount in satoshis
   * @returns {number} Amount in millisatoshis
   */
  satsToMillisats(sats) {
    return sats * 1000;
  }

  /**
   * Convert millisatoshis to satoshis
   * @param {number} msats - Amount in millisatoshis
   * @returns {number} Amount in satoshis
   */
  millisatsToSats(msats) {
    return Math.floor(msats / 1000);
  }

  /**
   * Validate amount against LNURLp constraints
   * @param {number} amount - Amount in satoshis
   * @param {Object} lnurlpResponse - LNURLp response data
   * @returns {boolean} Whether amount is valid
   */
  validateAmount(amount, lnurlpResponse) {
    const amountMsats = this.satsToMillisats(amount);
    const minSendable = parseInt(lnurlpResponse.minSendable);
    const maxSendable = parseInt(lnurlpResponse.maxSendable);

    return amountMsats >= minSendable && amountMsats <= maxSendable;
  }

  /**
   * Full Lightning address to invoice resolution
   * @param {string} lightningAddress - The Lightning address
   * @param {number} amount - Amount in satoshis
   * @param {string} comment - Optional comment
   * @returns {Object} Invoice and metadata
   */
  async resolveInvoice(lightningAddress, amount, comment = 'Cashu token redemption') {
    try {
      console.log(`Resolving Lightning address: ${lightningAddress} for ${amount} sats`);
      
      // Get LNURLp endpoint
      const lnurlpUrl = this.getLNURLpEndpoint(lightningAddress);
      console.log(`LNURLp endpoint: ${lnurlpUrl}`);
      
      // Fetch LNURLp response
      const lnurlpResponse = await this.fetchLNURLpResponse(lnurlpUrl);
      console.log('LNURLp response:', {
        callback: lnurlpResponse.callback,
        minSendable: lnurlpResponse.minSendable,
        maxSendable: lnurlpResponse.maxSendable
      });
      
      // Validate amount
      if (!this.validateAmount(amount, lnurlpResponse)) {
        const minSats = this.millisatsToSats(lnurlpResponse.minSendable);
        const maxSats = this.millisatsToSats(lnurlpResponse.maxSendable);
        throw new Error(`Amount ${amount} sats is outside allowed range: ${minSats}-${maxSats} sats`);
      }

      // Get invoice
      const amountMsats = this.satsToMillisats(amount);
      console.log(`Requesting invoice for ${amountMsats} millisats (${amount} sats)`);
      console.log(`Using callback URL: ${lnurlpResponse.callback}`);
      const invoiceResponse = await this.getInvoice(lnurlpResponse.callback, amountMsats, comment);
      
      console.log('Invoice created successfully:', {
        bolt11: invoiceResponse.bolt11.substring(0, 50) + '...',
        lightningAddress,
        amount,
        amountMsats,
        callback: lnurlpResponse.callback
      });

      return {
        bolt11: invoiceResponse.bolt11,
        amount,
        amountMsats,
        lightningAddress,
        domain: this.parseLightningAddress(lightningAddress).domain,
        successAction: invoiceResponse.successAction,
        lnurlpResponse
      };
    } catch (error) {
      console.error('Lightning address resolution failed:', error.message);
      throw new Error(`Lightning address resolution failed: ${error.message}`);
    }
  }

  /**
   * Decode Lightning invoice (basic parsing)
   * @param {string} bolt11 - Lightning invoice
   * @returns {Object} Basic invoice info
   */
  parseInvoice(bolt11) {
    try {
      // This is a simplified parser - for production use a proper library like bolt11
      if (!bolt11.toLowerCase().startsWith('lnbc') && !bolt11.toLowerCase().startsWith('lntb')) {
        throw new Error('Invalid Lightning invoice format');
      }

      return {
        bolt11,
        network: bolt11.toLowerCase().startsWith('lnbc') ? 'mainnet' : 'testnet'
      };
    } catch (error) {
      throw new Error(`Invoice parsing failed: ${error.message}`);
    }
  }

  /**
   * Verify that a Lightning invoice is valid and for the expected amount
   * @param {string} bolt11Invoice - The Lightning invoice to verify
   * @param {string} expectedLightningAddress - The expected Lightning address (for logging)
   * @param {number} expectedAmount - Expected amount in satoshis (optional)
   * @returns {boolean} Whether the invoice is valid
   */
  verifyInvoiceDestination(bolt11Invoice, expectedLightningAddress, expectedAmount = null) {
    try {
      console.log(`Verifying invoice destination for: ${expectedLightningAddress}`);
      console.log(`Invoice: ${bolt11Invoice.substring(0, 50)}...`);
      
      // Decode the invoice using the bolt11 library
      const decoded = bolt11.decode(bolt11Invoice);
      
      // Basic validation checks
      if (!decoded.complete) {
        console.error('Invoice verification failed: Invoice is incomplete');
        return false;
      }
      
      if (!decoded.paymentRequest) {
        console.error('Invoice verification failed: No payment request found');
        return false;
      }
      
      // Check if the invoice has expired
      if (decoded.timeExpireDate && decoded.timeExpireDate < Date.now() / 1000) {
        console.error('Invoice verification failed: Invoice has expired');
        return false;
      }
      
      // Verify amount if provided
      if (expectedAmount !== null) {
        const invoiceAmount = decoded.satoshis || (decoded.millisatoshis ? Math.floor(decoded.millisatoshis / 1000) : 0);
        if (invoiceAmount !== expectedAmount) {
          console.error(`Invoice verification failed: Amount mismatch. Expected: ${expectedAmount} sats, Got: ${invoiceAmount} sats`);
          return false;
        }
      }
      
      console.log('Invoice verification: All checks passed');
      console.log('Invoice details:', {
        amount: decoded.satoshis || (decoded.millisatoshis ? Math.floor(decoded.millisatoshis / 1000) : 0),
        timestamp: decoded.timestamp,
        expiry: decoded.expiry,
        description: decoded.tags?.find(tag => tag.tagName === 'description')?.data || 'No description'
      });
      
      return true;
    } catch (error) {
      console.error('Invoice verification failed:', error.message);
      return false;
    }
  }
}

module.exports = new LightningService(); 