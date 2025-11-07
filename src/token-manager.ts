import { GitLabServer, GitLabToken, TokenInfo, TokenHealthStatus } from './types';
import { GitLabClient } from './gitlab';

interface TokenWithHealth {
  token: GitLabToken;
  health: {
    status: 'valid' | 'expiring' | 'expired' | 'invalid';
    expiresAt: string | null;
    daysRemaining: number | null;
    message: string;
  };
}

export class TokenManager {
  private serverTokens: Map<string, TokenWithHealth[]> = new Map();

  /**
   * Normalize server tokens: support both legacy single token and new tokens array
   */
  private normalizeTokens(server: GitLabServer): GitLabToken[] {
    // New format: tokens array
    if (server.tokens && server.tokens.length > 0) {
      return server.tokens;
    }

    // Legacy format: single token field
    if (server.token) {
      return [{
        value: server.token,
        name: 'Primary Token',
      }];
    }

    return [];
  }

  /**
   * Calculate token health status
   */
  private calculateTokenHealth(expiresAt: string | null, isValid: boolean): TokenWithHealth['health'] {
    if (!isValid) {
      return {
        status: 'invalid',
        expiresAt: null,
        daysRemaining: null,
        message: 'Token is invalid or revoked',
      };
    }

    if (!expiresAt) {
      return {
        status: 'valid',
        expiresAt: null,
        daysRemaining: null,
        message: 'Token has no expiration',
      };
    }

    const expiryDate = new Date(expiresAt);
    const now = new Date();
    const msRemaining = expiryDate.getTime() - now.getTime();
    const daysRemaining = Math.ceil(msRemaining / (1000 * 60 * 60 * 24));

    if (daysRemaining < 0) {
      return {
        status: 'expired',
        expiresAt,
        daysRemaining,
        message: `Token expired ${Math.abs(daysRemaining)} days ago`,
      };
    }

    if (daysRemaining <= 7) {
      return {
        status: 'expiring',
        expiresAt,
        daysRemaining,
        message: `Token expires in ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''}`,
      };
    }

    return {
      status: 'valid',
      expiresAt,
      daysRemaining,
      message: `Token expires in ${daysRemaining} days`,
    };
  }

  /**
   * Validate and check health of all tokens for a server
   */
  async validateServerTokens(server: GitLabServer): Promise<TokenWithHealth[]> {
    const tokens = this.normalizeTokens(server);
    const results: TokenWithHealth[] = [];

    for (const token of tokens) {
      try {
        const client = new GitLabClient(server.url, token.value);
        const tokenInfo: TokenInfo = await client.getTokenInfo();

        const health = this.calculateTokenHealth(
          tokenInfo.expires_at,
          tokenInfo.active && !tokenInfo.revoked
        );

        results.push({
          token: {
            ...token,
            name: token.name || tokenInfo.name,
          },
          health,
        });

        // Log status
        const emoji = health.status === 'valid' ? '✓' : health.status === 'expiring' ? '⚠️' : '❌';
        console.log(`  ${emoji} Token "${token.name || tokenInfo.name}": ${health.message}`);

      } catch (error) {
        // Token is invalid
        results.push({
          token,
          health: {
            status: 'invalid',
            expiresAt: null,
            daysRemaining: null,
            message: `Failed to validate: ${(error as Error).message}`,
          },
        });
        console.error(`  ❌ Token "${token.name || 'Unknown'}": Invalid or unreachable`);
      }
    }

    // Cache results
    this.serverTokens.set(server.name, results);

    return results;
  }

  /**
   * Get first valid token for a server (fallback logic)
   */
  getValidToken(serverName: string): string | null {
    const tokens = this.serverTokens.get(serverName);
    if (!tokens || tokens.length === 0) {
      return null;
    }

    // Try to find first valid or expiring token (skip expired/invalid)
    const usableToken = tokens.find(t => 
      t.health.status === 'valid' || t.health.status === 'expiring'
    );

    if (usableToken) {
      if (usableToken.health.status === 'expiring') {
        console.warn(`⚠️  Using expiring token "${usableToken.token.name}" for ${serverName}: ${usableToken.health.message}`);
      }
      return usableToken.token.value;
    }

    // No valid tokens, return first one anyway (will fail but with proper error)
    console.error(`❌ No valid tokens for ${serverName}, using first token (may fail)`);
    return tokens[0].token.value;
  }

  /**
   * Get health status for all servers
   */
  getAllTokenStatus(): TokenHealthStatus[] {
    const statuses: TokenHealthStatus[] = [];

    for (const [serverName, tokens] of this.serverTokens.entries()) {
      statuses.push({
        serverName,
        tokens: tokens.map(t => ({
          name: t.token.name || 'Unnamed Token',
          status: t.health.status,
          expiresAt: t.health.expiresAt,
          daysRemaining: t.health.daysRemaining,
          message: t.health.message,
        })),
      });
    }

    return statuses;
  }

  /**
   * Check if any tokens are expiring soon or expired
   */
  hasWarnings(): boolean {
    for (const tokens of this.serverTokens.values()) {
      if (tokens.some(t => t.health.status === 'expiring' || t.health.status === 'expired' || t.health.status === 'invalid')) {
        return true;
      }
    }
    return false;
  }
}
