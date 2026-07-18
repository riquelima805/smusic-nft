

import {
  Connection,
  PublicKey,
  clusterApiUrl,
} from '@solana/web3.js';



export interface TensorNFT {
  mint: string;
  name: string;
  symbol: string;
  image?: string;
  listed: boolean;
  lastSalePrice?: number;
  listedPrice?: number; 
  owner?: string;
  attributes?: Record<string, string>;
  rarityRank?: number;
}

export interface TensorListing {
  mint: string;
  seller: string;
  price: number; 
  pdaAddress: string;
  rarity?: number;
  expireAt?: number;
}

export interface TensorActivity {
  mint: string;
  kind: 'buy' | 'sell' | 'list' | 'delist';
  price?: number;
  ts: number;
  tx: string;
}




export const ADLA_PROGRAM_ID = new PublicKey('2xaB1ZpMHpK1h44W7ogHtU3cng5bKtzfg6DHQMF9ELj2');


export const PAYMENT_MINT = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
export const PAYMENT_MINT_DECIMALS = 6;

const RPC_URL = clusterApiUrl('devnet'); 
const METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');


const LISTING_ACCOUNT_SIZE = 82;

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}
const CACHE_TTL = 60_000; 
function readU64LE(data: Uint8Array, offset: number): number {
  let value = 0n;
  for (let i = 7; i >= 0; i--) {
    value = (value << 8n) | BigInt(data[offset + i]);
  }
  
  return Number(value);
}


function decodeListing(pubkey: PublicKey, data: Uint8Array): TensorListing | null {
  if (data.length < LISTING_ACCOUNT_SIZE) return null;

  const seller = new PublicKey(data.slice(8, 40)).toBase58();
  const nftMint = new PublicKey(data.slice(40, 72)).toBase58();
  const price = readU64LE(data, 72);
  const active = data[80] === 1;

  if (!active) return null; 

  return {
    mint: nftMint,
    seller,
    price,
    pdaAddress: pubkey.toBase58(),
  };
}

async function fetchMetaplexMetadata(
  connection: Connection,
  mint: PublicKey
): Promise<{ name: string; symbol: string; uri: string } | null> {
  try {
    const [metadataPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('metadata'), METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
      METADATA_PROGRAM_ID
    );
    const accountInfo = await connection.getAccountInfo(metadataPda);
    if (!accountInfo) return null;

    const data = accountInfo.data;
    
    let offset = 1 + 32 + 32;

    const readBorshString = (fixedFieldLen: number): string => {
      const strLen = new DataView(data.buffer, data.byteOffset + offset, 4).getUint32(0, true);
      offset += 4;
      const bytes = data.slice(offset, offset + strLen);
      offset += fixedFieldLen; 
      return Buffer.from(bytes).toString('utf8').replace(/\0/g, '').trim();
    };

    const name = readBorshString(32);
    const symbol = readBorshString(10);
    const uri = readBorshString(200);

    return { name, symbol, uri };
  } catch (error) {
    console.warn('Metadata Metaplex não encontrada/parseável pra', mint.toBase58(), error);
    return null;
  }
}


async function fetchImageFromUri(uri: string): Promise<string | undefined> {
  if (!uri) return undefined;
  try {
    const res = await fetch(uri);
    if (!res.ok) return undefined;
    const json = await res.json();
    return json.image;
  } catch {
    return undefined;
  }
}



export class TensorTradeAdapter {
  private cache = new Map<string, CacheEntry<any>>();
  private connection = new Connection(RPC_URL, 'confirmed');

  constructor() {}

 
  async fetchListings(): Promise<TensorNFT[]> {
    const cacheKey = 'listings_adla_market';

    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      console.log(' Usando cache de listagens (on-chain)');
      return cached.data;
    }

    try {
      console.log(' Buscando Listings on-chain no programa adla_market (devnet)...');

      const accounts = await this.connection.getProgramAccounts(ADLA_PROGRAM_ID, {
        filters: [{ dataSize: LISTING_ACCOUNT_SIZE }],
      });

      console.log(`↳ ${accounts.length} contas Listing encontradas (ativas + inativas)`);

      const listings = accounts
        .map(({ pubkey, account }) => decodeListing(pubkey, account.data))
        .filter((l): l is TensorListing => l !== null);

      console.log(`✓ ${listings.length} listagens ATIVAS`);

     
      const nfts: TensorNFT[] = await Promise.all(
        listings.map(async (listing) => {
          const mintPk = new PublicKey(listing.mint);
          const meta = await fetchMetaplexMetadata(this.connection, mintPk);
          const image = meta?.uri ? await fetchImageFromUri(meta.uri) : undefined;

          return {
            mint: listing.mint,
            name: meta?.name || `NFT ${listing.mint.slice(0, 6)}…`,
            symbol: meta?.symbol || 'ADLA',
            image,
            listed: true,
            listedPrice: listing.price,
            owner: listing.seller,
          };
        })
      );

      this.cache.set(cacheKey, { data: nfts, expiresAt: Date.now() + CACHE_TTL });
      return nfts;
    } catch (error) {
      console.error(' Falha ao buscar listagens on-chain:', error);
      return [];
    }
  }


  async fetchNFT(mint: string): Promise<TensorNFT | null> {
    const cacheKey = 'nft_' + mint;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.data;

    try {
      const mintPk = new PublicKey(mint);
      const meta = await fetchMetaplexMetadata(this.connection, mintPk);
      if (!meta) return null;

      const image = await fetchImageFromUri(meta.uri);
      const nft: TensorNFT = {
        mint,
        name: meta.name,
        symbol: meta.symbol,
        image,
        listed: false,
      };

      this.cache.set(cacheKey, { data: nft, expiresAt: Date.now() + CACHE_TTL * 5 });
      return nft;
    } catch (error) {
      console.error(`❌ Falha ao buscar NFT ${mint}:`, error);
      return null;
    }
  }

  async fetchActivity(_limit = 50): Promise<TensorActivity[]> {
    return [];
  }

  async fetchStats(): Promise<{
    floorPrice: number;
    volume24h: number;
    listed: number;
    supply: number;
  } | null> {
    const nfts = await this.fetchListings();
    if (nfts.length === 0) return { floorPrice: 0, volume24h: 0, listed: 0, supply: 0 };

    const prices = nfts.map(n => n.listedPrice || 0).filter(p => p > 0);
    return {
      floorPrice: prices.length ? Math.min(...prices) : 0,
      volume24h: 0, // precisaria de indexador; deixado em 0 por enquanto
      listed: nfts.length,
      supply: nfts.length,
    };
  }

  prepareListingPurchase(listing: TensorListing): {
    mint: string;
    price: number;
    sellerAddress: string;
  } {
    return { mint: listing.mint, price: listing.price, sellerAddress: listing.seller };
  }

  prepareOffer(mint: string, amount: number): { mint: string; amount: number } {
    return { mint, amount };
  }

  async fetchUsdcBalance(ownerAddress: string): Promise<{ raw: number; decimal: number }> {
    const cacheKey = 'usdc_balance_' + ownerAddress;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.data;

    try {
      const owner = new PublicKey(ownerAddress);
      const { value: tokenAccounts } = await this.connection.getParsedTokenAccountsByOwner(owner, {
        mint: PAYMENT_MINT,
      });

      let decimal = 0;
      for (const { account } of tokenAccounts) {
        const amount = account.data.parsed?.info?.tokenAmount?.uiAmount;
        if (typeof amount === 'number') decimal += amount;
      }

      const result = {
        decimal,
        raw: TensorTradeAdapter.decimalToRaw(decimal),
      };

     
      this.cache.set(cacheKey, { data: result, expiresAt: Date.now() + 15_000 });
      return result;
    } catch (error) {
      console.error(` Falha ao buscar saldo USDC de ${ownerAddress}:`, error);
      return { raw: 0, decimal: 0 };
    }
  }

  clearCache() {
    this.cache.clear();
    console.log(' Cache do adapter on-chain limpo');
  }

 
  static rawToDecimal(raw: number): number {
    return raw / Math.pow(10, PAYMENT_MINT_DECIMALS);
  }

  static decimalToRaw(value: number): number {
    return Math.round(value * Math.pow(10, PAYMENT_MINT_DECIMALS));
  }
}

export const tensorAdapter = new TensorTradeAdapter();

