/**
 * TensorTradeAdapter.ts  (na prática: "AdlaMarketOnChainAdapter")
 *
 * Mantém o MESMO nome de arquivo e os MESMOS exports (TensorNFT,
 * TensorListing, TensorActivity, TensorTradeAdapter, tensorAdapter) só pra
 * `useTensorMarket.ts` continuar funcionando sem precisar mudar o import.
 *
 * Mas agora NÃO fala mais com Magic Eden/Tensor Trade. Lê DIRETO do seu
 * programa Anchor `adla_market` na devnet via `getProgramAccounts` — só os
 * NFTs que vocês mesmos listaram com `adla_nftList` aparecem aqui.
 *
 * Requisito: `npm install @solana/web3.js` (lib oficial da Solana, cuida de
 * PDA, base58, RPC — evita reinventar tudo isso em TS puro).
 *
 * ⚠️ IMPORTANTE — DECIMAIS DO PREÇO:
 * Antes (Tensor/Magic Eden) o preço vinha em "lamports" de SOL (9 casas
 * decimais). AGORA o preço vem em menor unidade do `payment_mint`
 * (USDC devnet = 6 casas decimais, não 9!). Isso afeta qualquer lugar do
 * App.tsx que faz `/ 1_000_000_000` pra mostrar o preço (ex: `priceLamports`,
 * `formatUsdEstimate`, e o `SolanaPriceService` que assume SOL). Ver aviso
 * completo no final deste arquivo.
 */

import {
  Connection,
  PublicKey,
  clusterApiUrl,
} from '@solana/web3.js';

// ============================================================================
// TIPOS (mantidos pra compatibilidade com useTensorMarket.ts)
// ============================================================================

export interface TensorNFT {
  mint: string;
  name: string;
  symbol: string;
  image?: string;
  listed: boolean;
  lastSalePrice?: number;
  listedPrice?: number; // menor unidade do payment_mint (NÃO é mais lamports de SOL)
  owner?: string;
  attributes?: Record<string, string>;
  rarityRank?: number;
}

export interface TensorListing {
  mint: string;
  seller: string;
  price: number; // menor unidade do payment_mint
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

// ============================================================================
// CONFIGURAÇÃO — bater 1:1 com AdlaAnchorClient.kt
// ============================================================================

export const ADLA_PROGRAM_ID = new PublicKey('2xaB1ZpMHpK1h44W7ogHtU3cng5bKtzfg6DHQMF9ELj2');

/** TODO: trocar quando o token $ADLA existir de verdade (ver AdlaAnchorClient.kt). */
export const PAYMENT_MINT = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'); // USDC devnet
export const PAYMENT_MINT_DECIMALS = 6; // USDC = 6 casas. Trocar se o payment_mint mudar.

const RPC_URL = clusterApiUrl('devnet'); // ou 'https://api.devnet.solana.com' direto
const METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

/** Tamanho exato da struct Listing on-chain: 8 (disc) + 32 + 32 + 8 + 1 + 1 = 82 bytes. */
const LISTING_ACCOUNT_SIZE = 82;

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}
const CACHE_TTL = 60_000; // 1 min

// ============================================================================
// HELPERS DE PARSE
// ============================================================================

/** Lê um u64 little-endian de um Buffer/Uint8Array a partir de um offset. */
function readU64LE(data: Uint8Array, offset: number): number {
  let value = 0n;
  for (let i = 7; i >= 0; i--) {
    value = (value << 8n) | BigInt(data[offset + i]);
  }
  // NFTs/preços em contexto de UI cabem tranquilo em Number (< 2^53)
  return Number(value);
}

/** Decodifica a struct Listing (ver `#[account] pub struct Listing` no lib.rs). */
function decodeListing(pubkey: PublicKey, data: Uint8Array): TensorListing | null {
  if (data.length < LISTING_ACCOUNT_SIZE) return null;

  const seller = new PublicKey(data.slice(8, 40)).toBase58();
  const nftMint = new PublicKey(data.slice(40, 72)).toBase58();
  const price = readU64LE(data, 72);
  const active = data[80] === 1;

  if (!active) return null; // só mostra listagens ativas

  return {
    mint: nftMint,
    seller,
    price,
    pdaAddress: pubkey.toBase58(),
  };
}

/** Parse simplificado do Metaplex Token Metadata (nome/símbolo/uri só, sem creators/collection). */
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
    // Layout: key(1) + updateAuthority(32) + mint(32) + name(4+32) + symbol(4+10) + uri(4+200) + ...
    let offset = 1 + 32 + 32;

    const readBorshString = (fixedFieldLen: number): string => {
      const strLen = new DataView(data.buffer, data.byteOffset + offset, 4).getUint32(0, true);
      offset += 4;
      const bytes = data.slice(offset, offset + strLen);
      offset += fixedFieldLen; // campo tem tamanho fixo reservado (32/10/200), independente do strLen real
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

/** Busca a imagem no JSON apontado pela URI do metadata (se existir e for acessível). */
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

// ============================================================================
// ADAPTER
// ============================================================================

export class TensorTradeAdapter {
  private cache = new Map<string, CacheEntry<any>>();
  private connection = new Connection(RPC_URL, 'confirmed');

  constructor() {}

  /**
   * Busca TODAS as listagens ativas do programa `adla_market` na devnet.
   * Usa `getProgramAccounts` com filtro de tamanho (mais barato que trazer
   * tudo e filtrar client-side).
   */
  async fetchListings(): Promise<TensorNFT[]> {
    const cacheKey = 'listings_adla_market';

    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      console.log('📦 Usando cache de listagens (on-chain)');
      return cached.data;
    }

    try {
      console.log('🔍 Buscando Listings on-chain no programa adla_market (devnet)...');

      const accounts = await this.connection.getProgramAccounts(ADLA_PROGRAM_ID, {
        filters: [{ dataSize: LISTING_ACCOUNT_SIZE }],
      });

      console.log(`↳ ${accounts.length} contas Listing encontradas (ativas + inativas)`);

      const listings = accounts
        .map(({ pubkey, account }) => decodeListing(pubkey, account.data))
        .filter((l): l is TensorListing => l !== null);

      console.log(`✓ ${listings.length} listagens ATIVAS`);

      // Enriquece com metadata (nome + imagem) — em paralelo, best-effort
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
      console.error('❌ Falha ao buscar listagens on-chain:', error);
      return [];
    }
  }

  /** Busca um NFT específico (lê Metaplex metadata; não indica se está listado). */
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

  /**
   * Atividade recente. SEM indexador próprio, isso exigiria varrer
   * `getSignaturesForAddress` do programa + decodificar cada instrução —
   * caro e lento de fazer client-side. Por enquanto retorna vazio; o
   * `activity` do App.tsx já é populado localmente pelas próprias ações do
   * usuário (`pushActivity`), então isso não bloqueia nada.
   */
  async fetchActivity(_limit = 50): Promise<TensorActivity[]> {
    return [];
  }

  /** Stats calculadas a partir das listagens já carregadas (sem histórico de volume). */
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

  clearCache() {
    this.cache.clear();
    console.log('🧹 Cache do adapter on-chain limpo');
  }

  /** Converte menor unidade do payment_mint pra unidade "inteira" (ex: micro-USDC -> USDC). */
  static rawToDecimal(raw: number): number {
    return raw / Math.pow(10, PAYMENT_MINT_DECIMALS);
  }

  static decimalToRaw(value: number): number {
    return Math.round(value * Math.pow(10, PAYMENT_MINT_DECIMALS));
  }
}

export const tensorAdapter = new TensorTradeAdapter();

/* ============================================================================
   ⚠️ AVISO — AJUSTE NECESSÁRIO NO RESTO DO App.tsx (decimais)
   ----------------------------------------------------------------------------
   O preço agora vem em MENOR UNIDADE DE USDC (6 casas), não em lamports de
   SOL (9 casas). Todo lugar do App.tsx / SolanaPriceService.ts que faz:

       price / 1_000_000_000        (assume SOL)

   deveria, pros itens vindos DESTE adapter, usar:

       TensorTradeAdapter.rawToDecimal(price)     // = price / 1_000_000

   Isso afeta principalmente:
     - `priceLamports` / `formatUsdEstimate()` no App.tsx (hoje assume SOL)
     - `SolanaPriceService.lamportsToUsd()` (também assume SOL/lamports)

   Como USDC já É dólar (1 USDC ≈ 1 USD), o mais simples pode ser: pra itens
   vindos do `adla_market`, NEM usar SolanaPriceService (que converte
   SOL→USD) — já é USD direto, só formatar com `rawToDecimal()` e exibir
   como "$ X.XX". Se quiser, eu já ajusto essa parte do App.tsx também.
   ========================================================================== */