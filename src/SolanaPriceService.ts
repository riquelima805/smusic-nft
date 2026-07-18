

interface PriceData {
  solUsd: number;
  usdSol: number; // Inverso
  fetchedAt: number;
  source: string;
}

const CACHE_TTL = 5 * 60_000;

const PRICE_SOURCES = [
  {
    name: 'CoinGecko',
    fetch: async () => {
      const res = await fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd'
      );
      const data = await res.json();
      return data.solana?.usd;
    },
  },
  {
    name: 'Pyth Network (Mainnet)',
    fetch: async () => {
      const res = await fetch(
        'https://api.mainnet-beta.solana.com',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getPrice',
            params: ['Nh3JMTy4qBKLqD5oM3o5LsU6G8DtryX9hUfvWQsEYQn'], // Pyth SOL/USD feed
          }),
        }
      );
      const data = await res.json();
    
      if (data.result?.price) return data.result.price;
      throw new Error('Pyth format mismatch');
    },
  },
  {
    name: 'Birdeye API',
    fetch: async () => {
      const res = await fetch(
        'https://public-api.birdeye.so/defi/token_price?address=So11111111111111111111111111111111111111112'
      );
      const data = await res.json();
      return data.data?.value;
    },
  },
];

class SolanaPriceService {
  private cache: PriceData | null = null;

  /**
   * Busca preço atual SOL/USD
   * Tenta múltiplas fontes até conseguir
   */
  async fetchPrice(): Promise<PriceData> {
    // Check cache
    if (this.cache && Date.now() - this.cache.fetchedAt < CACHE_TTL) {
      console.log(` Usando preço em cache: $${this.cache.solUsd}`);
      return this.cache;
    }

    console.log(' Buscando preço SOL/USD...');

    for (const source of PRICE_SOURCES) {
      try {
        const solUsd = await source.fetch();
        if (solUsd && solUsd > 0) {
          const priceData: PriceData = {
            solUsd,
            usdSol: 1 / solUsd,
            fetchedAt: Date.now(),
            source: source.name,
          };
          this.cache = priceData;
          console.log(`✓ Preço SOL/USD: $${solUsd.toFixed(2)} (${source.name})`);
          return priceData;
        }
      } catch (error) {
        console.warn(` ${source.name} falhou:`, error);
        continue;
      }
    }

    
    console.error('  Todas as APIs falharam, usando fallback $75');
    const fallback: PriceData = {
      solUsd: 150, // Preço default
      usdSol: 1 / 150,
      fetchedAt: Date.now(),
      source: 'FALLBACK',
    };
    this.cache = fallback;
    return fallback;
  }

  
  async solToUsd(sol: number): Promise<number> {
    const price = await this.fetchPrice();
    return sol * price.solUsd;
  }

 
  async usdToSol(usd: number): Promise<number> {
    const price = await this.fetchPrice();
    return usd * price.usdSol;
  }


  async lamportsToUsd(lamports: number): Promise<number> {
    const sol = lamports / 1_000_000_000;
    return this.solToUsd(sol);
  }

 
  async usdToLamports(usd: number): Promise<number> {
    const sol = await this.usdToSol(usd);
    return sol * 1_000_000_000;
  }

  
  getLastPrice(): number | null {
    return this.cache?.solUsd ?? null;
  }

  
  clearCache() {
    this.cache = null;
    console.log(' Cache de preço limpo');
  }

 
  async formatSolAsUsd(sol: number, decimals = 2): Promise<string> {
    const usd = await this.solToUsd(sol);
    return usd.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }

  
  async formatLamportsAsUsd(
    lamports: number,
    decimals = 2
  ): Promise<string> {
    const usd = await this.lamportsToUsd(lamports);
    return usd.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }
}

export const solanaPrice = new SolanaPriceService();
