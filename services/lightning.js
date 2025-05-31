const axios = require('axios');

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
      // Get LNURLp endpoint
      const lnurlpUrl = this.getLNURLpEndpoint(lightningAddress);
      
      // Fetch LNURLp response
      const lnurlpResponse = await this.fetchLNURLpResponse(lnurlpUrl);
      
      // Validate amount
      if (!this.validateAmount(amount, lnurlpResponse)) {
        const minSats = this.millisatsToSats(lnurlpResponse.minSendable);
        const maxSats = this.millisatsToSats(lnurlpResponse.maxSendable);
        throw new Error(`Amount ${amount} sats is outside allowed range: ${minSats}-${maxSats} sats`);
      }

      // Get invoice
      const amountMsats = this.satsToMillisats(amount);
      const invoiceResponse = await this.getInvoice(lnurlpResponse.callback, amountMsats, comment);

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
}

module.exports = new LightningService(); 