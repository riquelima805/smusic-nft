import React, { useState, useEffect, useCallback, useMemo, useRef, createContext } from 'react';
import './App.css';
// Integração de preço SOL/USD — mesmo serviço usado no teste (Apptestpegou/useTensorMarket).
// Ajuste o caminho abaixo conforme onde você colocar o arquivo no seu projeto.
import { useSolanaPrice } from './useTensorMarket';
// Preço agora vem em menor unidade de USDC (6 casas), via TensorTradeAdapter.rawToDecimal.
// Ajuste o caminho abaixo conforme onde você colocar TensorTradeAdapter.ts no seu projeto.
import { TensorTradeAdapter } from './TensorTradeAdapter';
// Logo importado como módulo: o Vite resolve o caminho final certo em build,
// respeitando o `base` (mesmo './') e sem depender da URL atual do navegador.
// Coloque o arquivo em src/assets/logo.png (veja instrução completa mais abaixo, no header).
import logoUrl from './assets/logo.png';

/* ============================================================================
   ADLA NFT MARKET — Colecionáveis do Fandom
   ----------------------------------------------------------------------------
   Mesmo padrão do ADLA DEFI: esta interface NÃO guarda chave privada e não
   fala direto com a L3. Ela conversa com a carteira injetada em
   `window.adlaWallet` (mesmo objeto usado pelo app de DeFi — é a MESMA
   carteira, só que aqui ela compra, vende e lista colecionáveis em vez de
   trocar/stakar tokens). Enquanto a extensão real não existe, tudo roda em
   "Modo Demo": as mesmas funções são chamadas, só que a resposta vem de
   dados simulados em memória.

   Contrato esperado do provider (ver `callBridge` mais abaixo). Os params
   batem 1:1 com as contas/instruções do programa Anchor `adla_market` na
   Solana — `mint` é o endereço do NFT (chave da conta Mint), obrigatório em
   toda chamada pra o bridge derivar as PDAs (`listing`, `vault`, `offer`,
   `escrow`) do lado nativo:
     - sol_requestAccounts    → string[]
     - sol_accounts           → string[]
     - adla_nftBuy            { mint, price }                    → { txId }
     - adla_nftMakeOffer      { mint, amount }                   → { txId }
     - adla_nftList           { mint, price }                    → { txId }
     - adla_nftUnlist         { mint }                           → { txId }
     - adla_nftAcceptOffer    { mint, buyerAddress }              → { txId }
     - adla_nftDeclineOffer   { mint, buyerAddress }              → { txId }
   Eventos (provider.on / removeListener):
     - 'accountsChanged' (string[]) · 'disconnect' () · 'chainChanged' (string)
   ============================================================================ */

// ---------------------------------------------------------------------------
// Bridge com a carteira (objeto injetado pelo navegador)
// ---------------------------------------------------------------------------

type AdlaMethod =
  | 'sol_requestAccounts' | 'sol_accounts'
  | 'adla_nftBuy' | 'adla_nftMakeOffer'
  | 'adla_nftList' | 'adla_nftUnlist'
  | 'adla_nftAcceptOffer' | 'adla_nftDeclineOffer';

type AdlaEvent = 'accountsChanged' | 'disconnect' | 'chainChanged' | 'txUpdate';

interface AdlaRequestArgs { method: AdlaMethod; params?: unknown[]; }

interface AdlaWalletProvider {
  isAdlaWallet?: boolean;
  chainId?: string;
  request<T = unknown>(args: AdlaRequestArgs): Promise<T>;
  on(event: AdlaEvent, handler: (...args: any[]) => void): void;
  removeListener(event: AdlaEvent, handler: (...args: any[]) => void): void;
}

declare global {
  interface Window {
    adlaWallet?: AdlaWalletProvider;
  }
}

/** Detecta `window.adlaWallet`, mesmo se a extensão injetar depois do mount. */
function useAdlaProvider(): AdlaWalletProvider | null {
  const [provider, setProvider] = useState<AdlaWalletProvider | null>(
    () => (typeof window !== 'undefined' ? window.adlaWallet ?? null : null)
  );

  useEffect(() => {
    if (provider) return;
    const pickUp = () => { if (window.adlaWallet) setProvider(window.adlaWallet); };
    window.addEventListener('adla#initialized', pickUp);
    let tries = 0;
    const id = window.setInterval(() => {
      tries += 1;
      pickUp();
      if (window.adlaWallet || tries > 20) window.clearInterval(id);
    }, 500);
    return () => { window.removeEventListener('adla#initialized', pickUp); window.clearInterval(id); };
  }, [provider]);

  return provider;
}

/** Chama o provider real quando existir; cai pro mock local em Modo Demo. */
async function callBridge<T>(
  provider: AdlaWalletProvider | null,
  demoMode: boolean,
  method: AdlaMethod,
  params: unknown[],
  applyMock: () => void
): Promise<T> {
  if (provider) {
    return provider.request<T>({ method, params });
  }
  if (demoMode) {
    await new Promise(r => setTimeout(r, 600 + Math.random() * 500));
    applyMock();
    return { txId: fakeTxId() } as unknown as T;
  }
  throw new Error('Nenhuma carteira ADLA conectada.');
}

// ---------------------------------------------------------------------------
// Tipos de domínio
// ---------------------------------------------------------------------------

type Category = 'token' | 'vault' | 'badge' | 'card' | 'pass';
type Rarity = 'COMUM' | 'RARO' | 'ÉPICO' | 'LENDÁRIO';
type ListingMode = 'buy' | 'offer' | 'unlisted';

interface NftItem {
  id: string;
  /** Endereço do mint SPL na Solana — identidade real do NFT no contrato. */
  mint: string;
  title: string;
  category: Category;
  rarity: Rarity;
  tags: string[];
  price: number;
  listingMode: ListingMode;
  edition?: string;
  likes: number;
  liked: boolean;
  owned: boolean;
  forSale: boolean;
  featured: boolean;
  /** Imagem real da carta/álbum (quando existir). Se ausente, cai no ícone padrão da categoria. */
  imageUrl?: string;
  /** Preço em menor unidade de USDC (6 casas) — vem do adla_market on-chain. Mock por enquanto. */
  priceRaw?: number;
  /** Nome do álbum de origem, pra exibir junto do artista quando o item vier de um álbum. */
  albumName?: string;
  artistName?: string;
}

interface IncomingOffer {
  id: string;
  itemId: string;
  /** Mint do NFT ofertado — necessário pra derivar a PDA `offer` no contrato. */
  mint: string;
  itemTitle: string;
  amount: number;
  from: string;
  /** Endereço completo do ofertante — a PDA `offer`/`escrow` é [mint, buyer]. */
  buyerAddress: string;
  ts: number;
}

interface ActivityItem {
  id: string;
  kind: 'buy' | 'sell' | 'offer' | 'list' | 'unlist' | 'decline';
  label: string;
  detail?: string;
  amount?: string;
  ts: number;
  status: 'confirmed' | 'pending';
}

type ViewKey = 'home' | 'market' | 'collection' | 'wallet' | 'profile';
type MarketTab = 'colecionaveis' | 'venda';
type SortKey = 'recentes' | 'preco_asc' | 'preco_desc' | 'populares';
type CategoryFilter = 'all' | Category;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const randomId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const fakeTxId = () => `0x${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`;

function genDemoAddress(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz023456789';
  let s = 'adla1';
  for (let i = 0; i < 38; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function shortAddr(addr: string): string {
  return addr.length > 14 ? `${addr.slice(0, 8)}…${addr.slice(-6)}` : addr;
}

function formatUsdc(n: number): string {
  return `${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`;
}

/**
 * Estimativa em USD a partir do preço bruto (menor unidade de USDC, 6 casas).
 * Como USDC já é dólar (1 USDC ≈ 1 USD), não precisamos mais do preço SOL/USD:
 * só converter com TensorTradeAdapter.rawToDecimal() e formatar como moeda.
 */
function formatUsdEstimate(priceRaw: number | undefined): string | null {
  if (!priceRaw) return null;
  const usd = TensorTradeAdapter.rawToDecimal(priceRaw);
  return usd.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Preço SOL/USD atual (via useSolanaPrice) disponível pra qualquer componente
// sem precisar passar prop por todo lugar — só usar o hook `useSolUsd()`.
const SolUsdContext = createContext<number | null>(null);
//const useSolUsd = () => useContext(SolUsdContext);

function timeAgo(ts: number): string {
  const d = Date.now() - ts;
  if (d < 60_000) return 'agora';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m atrás`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h atrás`;
  return `${Math.floor(d / 86_400_000)}d atrás`;
}

const CATEGORY_LABEL: Record<Category, string> = {
  token: 'Tokens de Liquidez', vault: 'Vaults', badge: 'Distintivos', card: 'Cartas', pass: 'Passes',
};
const CATEGORY_SHORT: Record<Category, string> = {
  token: 'Token', vault: 'Vault', badge: 'Distintivo', card: 'Carta', pass: 'Passe',
};
const RARITY_CLASS: Record<Rarity, string> = {
  COMUM: 'comum', RARO: 'raro', 'ÉPICO': 'epico', 'LENDÁRIO': 'lendario',
};

// ---------------------------------------------------------------------------
// Dados de álbuns/cartas — hoje vem de um JSON local (mock), amanhã troca por
// fetch numa API/indexer real sem mexer no resto do app. O formato abaixo é o
// MESMO que vocês já usam (album_id, cards[], nft_tx_id, image_url etc.) —
// só precisa apontar `ALBUMS_DATA` pra resposta da API quando ela existir.
// ---------------------------------------------------------------------------

interface AlbumCardData {
  card_id: string;
  nft_tx_id: string;
  image_url: string;
  idol_name: string;
  edition_name: string;
  likes: number;
  comments: number;
  shares: number;
  total_owned: number;
}

interface AlbumData {
  album_id: string;
  album_name: string;
  artist_name: string;
  cover_image_url: string;
  cards: AlbumCardData[];
}

// Placeholder — troque por `await fetch('/api/albums')` (ou o indexer da L3)
// quando o endpoint real estiver pronto. A UI já sabe consumir esse formato.
const ALBUMS_DATA: AlbumData[] = [
  {
    album_id: 'album_born_pink',
    album_name: 'Born Pink',
    artist_name: 'BLACKPINK',
    cover_image_url: 'https://pub-1f68b60058f841f7baa2f70e20400dc7.r2.dev/album/capablapink.png',
    cards: [
      { card_id: 'card001', nft_tx_id: 'at1exemplo0000000000000000000000000000000000000000000000000000', image_url: 'https://pub-1f68b60058f841f7baa2f70e20400dc7.r2.dev/album/jisso2.png', idol_name: 'Jisoo', edition_name: 'Base Pink', likes: 34, comments: 5, shares: 2, total_owned: 1 },
      { card_id: 'card002', nft_tx_id: 'at1exemplo0000000000000000000000000000000000000000000000000000', image_url: 'https://pub-1f68b60058f841f7baa2f70e20400dc7.r2.dev/album/jenie2.png', idol_name: 'Jennie', edition_name: 'Base Pink', likes: 34, comments: 5, shares: 2, total_owned: 1 },
      { card_id: 'card003', nft_tx_id: 'at1exemplo0000000000000000000000000000000000000000000000000000', image_url: 'https://pub-1f68b60058f841f7baa2f70e20400dc7.r2.dev/album/rose2.png', idol_name: 'Rosé', edition_name: 'Base Pink', likes: 34, comments: 5, shares: 2, total_owned: 1 },
      { card_id: 'card004', nft_tx_id: 'at1exemplo0000000000000000000000000000000000000000000000000000', image_url: 'https://pub-1f68b60058f841f7baa2f70e20400dc7.r2.dev/album/lisa2.png', idol_name: 'Lisa', edition_name: 'Base Pink', likes: 34, comments: 5, shares: 2, total_owned: 1 },
    ],
  },
];

// Raridades e preços ainda não vêm da API — sorteamos aqui só pra Modo Demo.
// Quando o backend passar a mandar `rarity`/`price_lamports` reais por carta,
// é só ler os valores em vez de sortear (os `Math.random()` abaixo somem).
const DEMO_RARITIES: Rarity[] = ['COMUM', 'RARO', 'ÉPICO', 'LENDÁRIO'];
function randomRarity(): Rarity {
  return DEMO_RARITIES[Math.floor(Math.random() * DEMO_RARITIES.length)];
}
/** Preço "de tela" em USDC (unidade inteira, ex: 240,00 USDC) — só pro Modo Demo. */
function randomPriceUsdc(): number {
  return Math.round((20 + Math.random() * 300) * 100) / 100;
}

function randomListingMode(): ListingMode {
  return Math.random() < 0.7 ? 'buy' : 'offer';
}

/** Converte os álbuns/cartas (JSON local por enquanto, API depois) em NftItem pro marketplace. */
function buildCatalogFromAlbums(albums: AlbumData[]): NftItem[] {
  const items: NftItem[] = [];
  albums.forEach(album => {
    album.cards.forEach((card, idx) => {
      const priceUsdc = randomPriceUsdc();
      items.push({
        id: card.card_id,
        mint: card.nft_tx_id,
        title: `${card.idol_name} · ${card.edition_name}`,
        category: 'card',
        rarity: randomRarity(),
        tags: [album.album_name.toUpperCase(), album.artist_name.toUpperCase()],
        price: priceUsdc,
        priceRaw: TensorTradeAdapter.decimalToRaw(priceUsdc), // mesmo valor, em menor unidade de USDC
        listingMode: randomListingMode(),
        edition: card.edition_name,
        likes: card.likes,
        liked: false,
        owned: card.total_owned > 0,
        forSale: false,
        featured: idx === 0,
        imageUrl: card.image_url,
        albumName: album.album_name,
        artistName: album.artist_name,
      });
    });
  });
  return items;
}

function genCatalog(): NftItem[] {
  return buildCatalogFromAlbums(ALBUMS_DATA);
}

function genIncomingOffers(): IncomingOffer[] {
  return [
    { id: 'o1', itemId: 'n3', mint: '', itemTitle: 'Carta Holográfica · Encore #014', amount: 2150, from: 'fã_anônimo·82f1', buyerAddress: genDemoAddress(), ts: Date.now() - 40 * 60_000 },
  ];
}

function genActivity(): ActivityItem[] {
  const now = Date.now();
  return [
    { id: randomId(), kind: 'buy', label: 'Compra · Token de Liquidez ETH/ADLA', amount: '-1.200,00 USDC', ts: now - 2 * 3_600_000, status: 'confirmed' },
    { id: randomId(), kind: 'list', label: 'Listado para venda · Carta Holográfica · Encore #014', amount: '2.400,00 USDC', ts: now - 26 * 3_600_000, status: 'confirmed' },
    { id: randomId(), kind: 'offer', label: 'Oferta enviada · Vault Estratégico Especial', amount: '700,00 USDC', ts: now - 3 * 24 * 3_600_000, status: 'pending' },
  ];
}

// ---------------------------------------------------------------------------
// Ícones (sem dependência externa)
// ---------------------------------------------------------------------------

type IconName =
  | 'home' | 'market' | 'collection' | 'wallet' | 'profile'
  | 'search' | 'filter' | 'heart' | 'close' | 'check' | 'chevronDown'
  | 'plus' | 'minus' | 'sparkle' | 'tag' | 'cart' | 'gavel' | 'copy'
  | 'coin' | 'box' | 'shield' | 'card' | 'ticket' | 'lock';

const ICONS: Record<IconName, React.ReactNode> = {
  home: <path d="M3 11.5 12 4l9 7.5M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9" />,
  market: <><rect x="4" y="4" width="7" height="7" rx="1.4" /><rect x="13" y="4" width="7" height="7" rx="1.4" /><rect x="4" y="13" width="7" height="7" rx="1.4" /><rect x="13" y="13" width="7" height="7" rx="1.4" /></>,
  collection: <><rect x="5" y="4" width="14" height="6" rx="1.4" /><rect x="5" y="10.5" width="14" height="6" rx="1.4" opacity="0.7" /><rect x="5" y="17" width="14" height="3.4" rx="1.4" opacity="0.45" /></>,
  wallet: <><rect x="3" y="7" width="18" height="13" rx="2.5" /><path d="M3 10h18" /><circle cx="16" cy="14.5" r="1.1" fill="currentColor" stroke="none" /></>,
  profile: <><circle cx="12" cy="8.2" r="3.4" /><path d="M5 20c0-3.6 3.1-6.2 7-6.2s7 2.6 7 6.2" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.3-4.3" /></>,
  filter: <path d="M4 5h16l-6.2 7.2v6.3l-3.6 1.9v-8.2z" />,
  heart: <path d="M12 19.3 4.8 12.2a4.6 4.6 0 1 1 7.2-5.6 4.6 4.6 0 1 1 7.2 5.6z" />,
  close: <path d="M5 5l14 14M19 5 5 19" />,
  check: <path d="M4 12.5 9 17 20 6" />,
  chevronDown: <path d="M5 8.5 12 15l7-6.5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  sparkle: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />,
  tag: <><path d="M3 11.3V4h7.3L21 14.7l-6.6 6.6z" /><circle cx="7.6" cy="7.6" r="1.3" fill="currentColor" stroke="none" /></>,
  cart: <><circle cx="9" cy="20" r="1.3" fill="currentColor" stroke="none" /><circle cx="17" cy="20" r="1.3" fill="currentColor" stroke="none" /><path d="M3 4h2l2.2 11.4a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.6L21 8H6" /></>,
  gavel: <><path d="M4 15.5 9.5 10l4 4-5.5 5.5z" /><path d="M13 6.5 18.5 12" /><path d="M3 21h8" /></>,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></>,
  coin: <><circle cx="12" cy="12" r="8.2" /><path d="M9 12h6M12 9v6" /></>,
  box: <><path d="M3 8 12 4l9 4-9 4-9-4z" /><path d="M3 8v8l9 4 9-4V8" /><path d="M12 12v8" /></>,
  shield: <path d="M12 3 19 6v6c0 5-3.5 7.5-7 9-3.5-1.5-7-4-7-9V6z" />,
  card: <><rect x="5" y="3" width="14" height="18" rx="2.2" /><path d="M9 8h6M9 12h6M9 16h3" /></>,
  ticket: <><rect x="3" y="7" width="18" height="10" rx="2.2" /><path d="M3 12h2M19 12h2" /><circle cx="12" cy="12" r="2" /></>,
  lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
};

function Icon({ name, size = 20, className = '', spin = false }: { name: IconName; size?: number; className?: string; spin?: boolean }) {
  if (spin) {
    return (
      <svg className={`icon icon-spin ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="34 100" />
      </svg>
    );
  }
  return (
    <svg className={`icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {ICONS[name]}
    </svg>
  );
}

const CATEGORY_ICON: Record<Category, IconName> = { token: 'coin', vault: 'box', badge: 'shield', card: 'card', pass: 'ticket' };

// ---------------------------------------------------------------------------
// Átomos de UI
// ---------------------------------------------------------------------------

function BottomSheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-handle" />
        <div className="sheet-head">
          <h3>{title}</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Fechar">
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

function RarityBadge({ rarity, size = 'md' }: { rarity: Rarity; size?: 'sm' | 'md' }) {
  return <span className={`rarity-badge rarity-${RARITY_CLASS[rarity]} rarity-${size}`}>{rarity}</span>;
}

function NftArt({ category, rarity, size = 'md', owned = false, imageUrl }: { category: Category; rarity: Rarity; size?: 'sm' | 'md' | 'lg'; owned?: boolean; imageUrl?: string }) {
  const [imgFailed, setImgFailed] = useState(false);
  const showImage = !!imageUrl && !imgFailed;
  return (
    <div className={`nft-art nft-art-${size} nft-art-${category} rarity-glow-${RARITY_CLASS[rarity]}`}>
      <span className="nft-art-shine" aria-hidden="true" />
      {showImage ? (
        <img
          src={imageUrl}
          alt=""
          onError={() => setImgFailed(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit', position: 'relative', zIndex: 0 }}
        />
      ) : (
        <Icon name={CATEGORY_ICON[category]} size={size === 'lg' ? 56 : size === 'md' ? 34 : 24} />
      )}
      {owned && (
        <span className="nft-owned-ribbon"><Icon name="check" size={11} /> Sua</span>
      )}
    </div>
  );
}

function LikeButton({ liked, likes, onToggle, size = 'md' }: { liked: boolean; likes: number; onToggle: () => void; size?: 'sm' | 'md' }) {
  return (
    <button
      type="button"
      className={`like-btn like-${size} ${liked ? 'is-liked' : ''}`}
      onClick={e => { e.stopPropagation(); onToggle(); }}
      aria-pressed={liked}
      aria-label="Curtir"
    >
      <Icon name="heart" size={size === 'sm' ? 13 : 15} />
      <span>{likes}</span>
    </button>
  );
}

function SearchBar({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="search-bar">
      <Icon name="search" size={16} />
      <input
        type="text"
        inputMode="search"
        placeholder="Buscar colecionáveis…"
        value={value}
        onChange={e => onChange(e.target.value)}
      />
      {value && (
        <button type="button" className="search-clear" onClick={() => onChange('')} aria-label="Limpar busca">
          <Icon name="close" size={13} />
        </button>
      )}
    </div>
  );
}

function CategoryChips({ value, onChange }: { value: CategoryFilter; onChange: (c: CategoryFilter) => void }) {
  const cats: CategoryFilter[] = ['all', 'token', 'vault', 'badge', 'card', 'pass'];
  return (
    <div className="category-chips">
      {cats.map(c => (
        <button
          type="button"
          key={c}
          className={`chip ${value === c ? 'chip-active' : ''}`}
          onClick={() => onChange(c)}
        >
          {c !== 'all' && <Icon name={CATEGORY_ICON[c]} size={14} />}
          {c === 'all' ? 'Todos' : CATEGORY_LABEL[c]}
        </button>
      ))}
    </div>
  );
}

function WalletButton({
  hasProvider, address, connecting, demoMode, onConnect, onDisconnect, onToggleDemo,
}: {
  hasProvider: boolean; address: string; connecting: boolean; demoMode: boolean;
  onConnect: () => void; onDisconnect: () => void; onToggleDemo: (v: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  if (!address) {
    return (
      <button type="button" className="btn-connect" onClick={onConnect} disabled={connecting}>
        <Icon name="wallet" size={16} spin={connecting} />
        {connecting ? 'Conectando…' : 'Conectar Carteira'}
      </button>
    );
  }

  return (
    <div className="wallet-pill-wrap" ref={ref}>
      <button type="button" className="wallet-pill" onClick={() => setOpen(o => !o)}>
        <span className={`live-dot ${hasProvider && !demoMode ? 'is-live' : 'is-demo'}`} />
        {shortAddr(address)}
        <Icon name="chevronDown" size={14} />
      </button>
      {open && (
        <div className="wallet-dropdown">
          <div className="wallet-dropdown-addr">{address}</div>
          <button type="button" className="dropdown-item" onClick={() => navigator.clipboard?.writeText(address)}>
            <Icon name="copy" size={15} /> Copiar endereço
          </button>
          <label className="dropdown-item dropdown-toggle">
            <span>Modo Demo</span>
            <input type="checkbox" checked={demoMode} onChange={e => onToggleDemo(e.target.checked)} />
          </label>
          <button type="button" className="dropdown-item dropdown-danger" onClick={() => { onDisconnect(); setOpen(false); }}>Desconectar</button>
        </div>
      )}
    </div>
  );
}

function InstallHintSheet({ open, onClose, onDemo }: { open: boolean; onClose: () => void; onDemo: () => void }) {
  return (
    <BottomSheet open={open} onClose={onClose} title="Carteira ADLA não detectada">
      <p className="sheet-text">
        Este marketplace se conecta à mesma carteira injetada em <code>window.adlaWallet</code> usada
        pelo ADLA DEFI. Quando a extensão for publicada, comprar e vender aqui já fala direto com a
        L3 — nada nessa interface precisa mudar.
      </p>
      <p className="sheet-text">Por enquanto, dá pra explorar tudo com dados de demonstração.</p>
      <button type="button" className="btn-ghost" disabled>
        Obter Carteira ADLA <span className="soon-badge">em breve</span>
      </button>
      <button type="button" className="btn-primary-cta" onClick={onDemo}>Entrar no Modo Demo</button>
    </BottomSheet>
  );
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

function FeaturedCard({ item, onOpen, onToggleLike }: { item: NftItem; onOpen: (i: NftItem) => void; onToggleLike: (i: NftItem) => void }) {
  const usdEstimate = formatUsdEstimate(item.priceRaw);
  return (
    <div className="feature-card" onClick={() => onOpen(item)}>
      <div className="feature-card-art">
        <NftArt category={item.category} rarity={item.rarity} size="lg" owned={item.owned} imageUrl={item.imageUrl} />
        <LikeButton liked={item.liked} likes={item.likes} onToggle={() => onToggleLike(item)} />
      </div>
      <div className="feature-card-info">
        <h4>{item.title}</h4>
        <p className="feature-tags">
          <RarityBadge rarity={item.rarity} size="sm" /> {item.tags.join(' · ')}
        </p>
        <div className="feature-price-row">
          <div className="feature-price">
            <span className="label">{item.listingMode === 'offer' ? 'Oferta sugerida' : 'Preço'}</span>
            <span className="value">{formatUsdc(item.price)}</span>
            {usdEstimate && (
              <span className="label" style={{ marginTop: 2 }}>≈ {usdEstimate}</span>
            )}
          </div>
          <button type="button" className="btn-buy-now" onClick={e => { e.stopPropagation(); onOpen(item); }}>
            {item.owned ? 'Ver item' : item.listingMode === 'buy' ? <><Icon name="cart" size={14} /> Comprar</> : <><Icon name="gavel" size={14} /> Oferta</>}
          </button>
        </div>
      </div>
    </div>
  );
}

function FeaturedCarousel({ items, onOpen, onToggleLike }: { items: NftItem[]; onOpen: (i: NftItem) => void; onToggleLike: (i: NftItem) => void }) {
  const [active, setActive] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);

  const onScroll = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const idx = Math.round(el.scrollLeft / (el.clientWidth * 0.86));
    setActive(Math.max(0, Math.min(items.length - 1, idx)));
  }, [items.length]);

  return (
    <div className="feature-carousel">
      <div className="feature-track" ref={trackRef} onScroll={onScroll}>
        {items.map(item => (
          <div className="feature-slide" key={item.id}>
            <FeaturedCard item={item} onOpen={onOpen} onToggleLike={onToggleLike} />
          </div>
        ))}
      </div>
      <div className="feature-dots">
        {items.map((_, i) => <span key={i} className={`feature-dot ${i === active ? 'is-active' : ''}`} />)}
      </div>
    </div>
  );
}

function NftGridCard({ item, onOpen, onToggleLike }: { item: NftItem; onOpen: (i: NftItem) => void; onToggleLike: (i: NftItem) => void }) {
  const usdEstimate = formatUsdEstimate(item.priceRaw);
  return (
    <div className="grid-card" onClick={() => onOpen(item)}>
      <div className="grid-card-art">
        <NftArt category={item.category} rarity={item.rarity} size="md" owned={item.owned} imageUrl={item.imageUrl} />
        {item.forSale && <span className="for-sale-tag">À VENDA</span>}
      </div>
      <div className="grid-card-body">
        <p className="grid-card-title">{item.title}</p>
        <div className="grid-card-meta">
          <RarityBadge rarity={item.rarity} size="sm" />
          {item.edition && <span className="grid-card-edition">{item.edition}</span>}
        </div>
        <div className="grid-card-foot">
          {item.listingMode === 'unlisted' ? (
            <span className="grid-card-locked">
              <Icon name={item.owned ? 'check' : 'lock'} size={12} /> {item.owned ? 'Conquistado' : 'Bloqueado'}
            </span>
          ) : (
            <>
              <span className="grid-card-price">
                {formatUsdc(item.price)}
                {usdEstimate && <><br /><span style={{ fontSize: '0.75em', opacity: 0.65 }}>≈ {usdEstimate}</span></>}
              </span>
              {!item.owned && (
                <button type="button" className="grid-card-cta" onClick={e => { e.stopPropagation(); onOpen(item); }}>
                  {item.listingMode === 'buy' ? <Icon name="cart" size={13} /> : <Icon name="gavel" size={13} />}
                </button>
              )}
            </>
          )}
        </div>
        <LikeButton liked={item.liked} likes={item.likes} onToggle={() => onToggleLike(item)} size="sm" />
      </div>
    </div>
  );
}

function OfferRow({ offer, busy, onAccept, onDecline }: { offer: IncomingOffer; busy: boolean; onAccept: (o: IncomingOffer) => void; onDecline: (o: IncomingOffer) => void }) {
  return (
    <div className="offer-row">
      <div className="offer-info">
        <span className="offer-item">{offer.itemTitle}</span>
        <span className="offer-from">de {offer.from} · {timeAgo(offer.ts)}</span>
      </div>
      <div className="offer-actions">
        <span className="offer-amount">{formatUsdc(offer.amount)}</span>
        <div className="offer-btns">
          <button type="button" className="btn-ghost btn-ghost-danger" disabled={busy} onClick={() => onDecline(offer)}>Recusar</button>
          <button type="button" className="btn-accept" disabled={busy} onClick={() => onAccept(offer)}>Aceitar</button>
        </div>
      </div>
    </div>
  );
}

const ACTIVITY_ICON: Record<ActivityItem['kind'], IconName> = {
  buy: 'cart', sell: 'sparkle', offer: 'gavel', list: 'tag', unlist: 'minus', decline: 'close',
};

function ActivityRow({ item }: { item: ActivityItem }) {
  return (
    <div className="activity-row">
      <span className="activity-icon"><Icon name={ACTIVITY_ICON[item.kind]} size={17} /></span>
      <div className="activity-info">
        <span className="activity-label">{item.label}</span>
        {item.detail && <span className="activity-detail">{item.detail}</span>}
      </div>
      <div className="activity-meta">
        {item.amount && <span className="activity-amount">{item.amount}</span>}
        <span className={`activity-status status-${item.status}`}>{item.status === 'confirmed' ? 'Confirmado' : 'Pendente'}</span>
        <span className="activity-time">{timeAgo(item.ts)}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------

function FilterSheet({
  open, onClose, category, onCategory, sort, onSort,
}: {
  open: boolean; onClose: () => void;
  category: CategoryFilter; onCategory: (c: CategoryFilter) => void;
  sort: SortKey; onSort: (s: SortKey) => void;
}) {
  const sorts: { key: SortKey; label: string }[] = [
    { key: 'recentes', label: 'Mais recentes' },
    { key: 'preco_asc', label: 'Menor preço' },
    { key: 'preco_desc', label: 'Maior preço' },
    { key: 'populares', label: 'Mais curtidos' },
  ];
  return (
    <BottomSheet open={open} onClose={onClose} title="Filtrar Colecionáveis">
      <label className="sheet-label">Categoria</label>
      <CategoryChips value={category} onChange={onCategory} />
      <label className="sheet-label" style={{ marginTop: 4 }}>Ordenar por</label>
      <div className="sort-pills">
        {sorts.map(s => (
          <button type="button" key={s.key} className={`pill ${sort === s.key ? 'pill-active' : ''}`} onClick={() => onSort(s.key)}>{s.label}</button>
        ))}
      </div>
      <button type="button" className="btn-primary-cta" onClick={onClose}>Ver Resultados</button>
    </BottomSheet>
  );
}

function ItemSheet({
  item, open, onClose, busy, adlaBalance,
  offerAmount, onOfferAmount, listPrice, onListPrice,
  buyConfirming, onRequestBuy, onOffer, onList, onUnlist, onToggleLike,
}: {
  item: NftItem | null; open: boolean; onClose: () => void; busy: boolean; adlaBalance: number;
  offerAmount: string; onOfferAmount: (v: string) => void;
  listPrice: string; onListPrice: (v: string) => void;
  buyConfirming: boolean;
  onRequestBuy: (item: NftItem) => void;
  onOffer: (item: NftItem, amount: number) => void;
  onList: (item: NftItem, price: number) => void;
  onUnlist: (item: NftItem) => void;
  onToggleLike: (item: NftItem) => void;
}) {
  if (!item) return null;
  const canAfford = adlaBalance >= item.price;
  const usdEstimate = formatUsdEstimate(item.priceRaw);

  return (
    <BottomSheet open={open} onClose={onClose} title="Detalhes do Item">
      <div className="item-sheet-art">
        <NftArt category={item.category} rarity={item.rarity} size="lg" owned={item.owned} imageUrl={item.imageUrl} />
      </div>
      {item.artistName && (
        <p className="sheet-text" style={{ marginTop: 4, marginBottom: -4, opacity: 0.75 }}>
          {item.artistName} · {item.albumName}
        </p>
      )}
      <div className="item-sheet-head">
        <h4>{item.title}</h4>
        <LikeButton liked={item.liked} likes={item.likes} onToggle={() => onToggleLike(item)} />
      </div>
      <div className="item-sheet-tags">
        <RarityBadge rarity={item.rarity} />
        <span className="item-sheet-cat"><Icon name={CATEGORY_ICON[item.category]} size={13} /> {CATEGORY_SHORT[item.category]}</span>
        {item.edition && <span className="item-sheet-edition">Edição {item.edition}</span>}
      </div>
      <p className="sheet-text">{item.tags.join(' · ')}</p>

      {/* Não comercializável — distintivo/conquista */}
      {item.listingMode === 'unlisted' && (
        item.owned ? (
          <div className="item-sheet-note note-owned">
            <Icon name="check" size={15} /> Você já conquistou este distintivo. Itens deste tipo não são transferíveis — ficam para sempre na sua coleção.
          </div>
        ) : (
          <div className="item-sheet-note note-locked">
            <Icon name="lock" size={15} /> Conquista ainda não desbloqueada. Cumpra o requisito acima para recebê-la automaticamente na sua carteira.
          </div>
        )
      )}

      {/* Item de terceiro à venda — comprar ou ofertar */}
      {item.listingMode !== 'unlisted' && !item.owned && (
        <>
          <div className="sheet-token-row">
            <span>Seu saldo</span>
            <span className="item-sheet-balance">{formatUsdc(adlaBalance)}</span>
          </div>
          {item.listingMode === 'buy' ? (
            <>
              {usdEstimate && <p className="sheet-text" style={{ marginTop: -4 }}>Estimativa em mercado real: ≈ {usdEstimate}</p>}
              {!canAfford && <p className="item-sheet-warn">Saldo insuficiente para esta compra.</p>}
              <button type="button" className="btn-primary-cta" disabled={busy || !canAfford} onClick={() => onRequestBuy(item)}>
                {busy ? 'Confirmando…' : buyConfirming ? `Confirmar Compra · ${formatUsdc(item.price)}` : <><Icon name="cart" size={16} /> Comprar por {formatUsdc(item.price)}</>}
              </button>
            </>
          ) : (
            <>
              <label className="sheet-label">Valor da oferta</label>
              <input className="sheet-amount-input" inputMode="decimal" placeholder={`Sugerido: ${item.price}`} value={offerAmount} onChange={e => onOfferAmount(e.target.value)} />
              <button
                type="button"
                className="btn-primary-cta"
                disabled={busy || !offerAmount || parseFloat(offerAmount.replace(',', '.')) <= 0}
                onClick={() => onOffer(item, parseFloat(offerAmount.replace(',', '.')))}
              >
                {busy ? 'Enviando…' : <><Icon name="gavel" size={16} /> Enviar Oferta</>}
              </button>
            </>
          )}
        </>
      )}

      {/* Item que eu possuo e posso (des)listar */}
      {item.listingMode !== 'unlisted' && item.owned && (
        item.forSale ? (
          <>
            <div className="item-sheet-note note-owned">
              <Icon name="tag" size={15} /> Listado à venda por <strong>{formatUsdc(item.price)}</strong>.
            </div>
            <button type="button" className="btn-ghost btn-ghost-danger" style={{ width: '100%', justifyContent: 'center', marginTop: 6 }} disabled={busy} onClick={() => onUnlist(item)}>
              {busy ? 'Removendo…' : 'Remover da Venda'}
            </button>
          </>
        ) : (
          <>
            <label className="sheet-label">Preço de venda</label>
            <input className="sheet-amount-input" inputMode="decimal" placeholder="0.0" value={listPrice} onChange={e => onListPrice(e.target.value)} />
            <button
              type="button"
              className="btn-primary-cta"
              disabled={busy || !listPrice || parseFloat(listPrice.replace(',', '.')) <= 0}
              onClick={() => onList(item, parseFloat(listPrice.replace(',', '.')))}
            >
              {busy ? 'Listando…' : <><Icon name="tag" size={16} /> Listar para Venda</>}
            </button>
          </>
        )
      )}
    </BottomSheet>
  );
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

function HomeView({
  ownedCount, forSaleCount, collectionValue, adlaBalance, offersCount,
  featured, onOpen, onToggleLike, onGoMarket, onGoCollection, onGoSell,
}: {
  ownedCount: number; forSaleCount: number; collectionValue: number; adlaBalance: number; offersCount: number;
  featured: NftItem[]; onOpen: (i: NftItem) => void; onToggleLike: (i: NftItem) => void;
  onGoMarket: () => void; onGoCollection: () => void; onGoSell: () => void;
}) {
  return (
    <div className="view-stack">
      <section className="card hero-card">
        <p className="eyebrow">SEU COFRE DE COLECIONÁVEIS</p>
        <div className="hero-row">
          <h2 className="hero-value">{formatUsdc(collectionValue)}</h2>
        </div>
        <p className="hero-sub">Valor estimado da sua coleção · {ownedCount} {ownedCount === 1 ? 'item' : 'itens'}</p>
        <div className="action-row">
          <button type="button" className="btn-action" onClick={onGoCollection}><Icon name="collection" size={16} /> Coleção</button>
          <button type="button" className="btn-action" onClick={onGoSell}><Icon name="tag" size={16} /> Vender</button>
          <button type="button" className="btn-action btn-action-primary" onClick={onGoMarket}><Icon name="market" size={16} /> Explorar</button>
        </div>
      </section>

      <section className="card">
        <div className="section-head">
          <div>
            <p className="eyebrow">VITRINE DO FANDOM</p>
            <h3>Em Destaque</h3>
          </div>
        </div>
        <FeaturedCarousel items={featured} onOpen={onOpen} onToggleLike={onToggleLike} />
      </section>

      <section className="card">
        <div className="section-head">
          <div>
            <p className="eyebrow">RESUMO</p>
            <h3>Sua Carteira</h3>
          </div>
        </div>
        <div className="home-stats-grid">
          <div className="home-stat"><span className="stat-label">Saldo</span><span className="stat-value">{formatUsdc(adlaBalance)}</span></div>
          <div className="home-stat"><span className="stat-label">À venda</span><span className="stat-value">{forSaleCount}</span></div>
          <div className="home-stat"><span className="stat-label">Ofertas recebidas</span><span className="stat-value stat-apy">{offersCount}</span></div>
        </div>
      </section>
    </div>
  );
}

function MarketView({
  items, marketTab, onMarketTab, search, onSearch, onOpenFilter, category, sort,
  incomingOffers, busy, onOpen, onToggleLike, onAcceptOffer, onDeclineOffer,
}: {
  items: NftItem[]; marketTab: MarketTab; onMarketTab: (t: MarketTab) => void;
  search: string; onSearch: (v: string) => void; onOpenFilter: () => void;
  category: CategoryFilter; sort: SortKey;
  incomingOffers: IncomingOffer[]; busy: boolean;
  onOpen: (i: NftItem) => void; onToggleLike: (i: NftItem) => void;
  onAcceptOffer: (o: IncomingOffer) => void; onDeclineOffer: (o: IncomingOffer) => void;
}) {
  const activeFilters = (category !== 'all' ? 1 : 0) + (sort !== 'recentes' ? 1 : 0);
  return (
    <div className="view-stack">
      <section className="card">
        <p className="eyebrow">ADLA NFT MARKET</p>
        <h3>{marketTab === 'colecionaveis' ? 'Colecionáveis' : 'Sua Vitrine de Venda'}</h3>

        <SearchBar value={search} onChange={onSearch} />

        <div className="market-tabs">
          <button type="button" className={`market-tab ${marketTab === 'colecionaveis' ? 'is-active' : ''}`} onClick={() => onMarketTab('colecionaveis')}>Colecionáveis</button>
          <button type="button" className={`market-tab ${marketTab === 'venda' ? 'is-active' : ''}`} onClick={() => onMarketTab('venda')}>Venda</button>
        </div>

        {marketTab === 'venda' && incomingOffers.length > 0 && (
          <div className="offers-list">
            <p className="eyebrow" style={{ marginTop: 4 }}>OFERTAS RECEBIDAS</p>
            {incomingOffers.map(o => (
              <OfferRow key={o.id} offer={o} busy={busy} onAccept={onAcceptOffer} onDecline={onDeclineOffer} />
            ))}
          </div>
        )}

        <div className="section-head" style={{ marginTop: 14 }}>
          <div>
            <p className="eyebrow">{marketTab === 'colecionaveis' ? 'CARTAS COLECIONÁVEIS' : 'SEUS ITENS'}</p>
            <h3 style={{ fontSize: 'var(--text-base)' }}>{items.length} {items.length === 1 ? 'item' : 'itens'}</h3>
          </div>
          <button type="button" className="btn-ghost" onClick={onOpenFilter}>
            <Icon name="filter" size={14} /> Filtrar {activeFilters > 0 && <span className="filter-count">{activeFilters}</span>}
          </button>
        </div>

        {items.length === 0 ? (
          <div className="empty-state">
            <Icon name="market" size={26} />
            <p>Nada encontrado.</p>
            <span>Tente outra busca ou ajuste os filtros.</span>
          </div>
        ) : (
          <div className="nft-grid">
            {items.map(i => <NftGridCard key={i.id} item={i} onOpen={onOpen} onToggleLike={onToggleLike} />)}
          </div>
        )}
      </section>
    </div>
  );
}

function CollectionView({ items, onOpen, onToggleLike }: { items: NftItem[]; onOpen: (i: NftItem) => void; onToggleLike: (i: NftItem) => void }) {
  const value = items.reduce((s, i) => s + (i.listingMode === 'unlisted' ? 0 : i.price), 0);
  return (
    <div className="view-stack">
      <section className="card">
        <p className="eyebrow">MINHA COLEÇÃO</p>
        <h3>Sua Galeria</h3>
        <div className="home-stats-grid" style={{ marginTop: 10 }}>
          <div className="home-stat"><span className="stat-label">Itens</span><span className="stat-value">{items.length}</span></div>
          <div className="home-stat"><span className="stat-label">Valor estimado</span><span className="stat-value">{formatUsdc(value)}</span></div>
          <div className="home-stat"><span className="stat-label">À venda</span><span className="stat-value">{items.filter(i => i.forSale).length}</span></div>
        </div>
      </section>

      <section className="card">
        {items.length === 0 ? (
          <div className="empty-state">
            <Icon name="collection" size={26} />
            <p>Sua coleção está vazia.</p>
            <span>Itens comprados ou conquistados no mercado aparecem aqui.</span>
          </div>
        ) : (
          <div className="nft-grid">
            {items.map(i => <NftGridCard key={i.id} item={i} onOpen={onOpen} onToggleLike={onToggleLike} />)}
          </div>
        )}
      </section>
    </div>
  );
}

function WalletView({
  address, adlaBalance, ownedItems, activity,
}: {
  address: string; adlaBalance: number; ownedItems: NftItem[]; activity: ActivityItem[];
}) {
  return (
    <div className="view-stack">
      <section className="card hero-card">
        <p className="eyebrow">CARTEIRA</p>
        <div className="hero-row">
          <h2 className="hero-value">{formatUsdc(adlaBalance)}</h2>
        </div>
        <p className="hero-sub">{address ? shortAddr(address) : 'Carteira não conectada'}</p>
      </section>

      <section className="card">
        <div className="section-head">
          <div>
            <p className="eyebrow">ATIVOS</p>
            <h3>NFTs na Carteira</h3>
          </div>
        </div>
        {ownedItems.length === 0 ? (
          <div className="empty-state">
            <Icon name="wallet" size={26} />
            <p>Nenhum NFT por aqui ainda.</p>
            <span>Compre ou conquiste itens no marketplace.</span>
          </div>
        ) : (
          <div className="wallet-asset-list">
            {ownedItems.map(i => (
              <div className="wallet-asset-row" key={i.id}>
                <span className="wallet-asset-icon"><Icon name={CATEGORY_ICON[i.category]} size={17} /></span>
                <div className="wallet-asset-info">
                  <span className="wallet-asset-name">{i.title}</span>
                  <span className="wallet-asset-cat">{CATEGORY_SHORT[i.category]} · {i.rarity}</span>
                </div>
                <span className="wallet-asset-value">{i.listingMode === 'unlisted' ? '—' : formatUsdc(i.price)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <div className="section-head">
          <div>
            <p className="eyebrow">EXTRATO</p>
            <h3>Atividade</h3>
          </div>
        </div>
        {activity.length === 0 ? (
          <div className="empty-state">
            <Icon name="sparkle" size={26} />
            <p>Nada por aqui ainda.</p>
          </div>
        ) : (
          <div className="activity-list">
            {activity.map(a => <ActivityRow key={a.id} item={a} />)}
          </div>
        )}
      </section>
    </div>
  );
}

function ProfileView({
  address, demoMode, onToggleDemo, ownedCount, soldCount, sentOffersCount, volume,
}: {
  address: string; demoMode: boolean; onToggleDemo: (v: boolean) => void;
  ownedCount: number; soldCount: number; sentOffersCount: number; volume: number;
}) {
  return (
    <div className="view-stack">
      <section className="card hero-card">
        <p className="eyebrow">PERFIL</p>
        <div className="profile-id-row">
          <span className="profile-avatar"><Icon name="profile" size={26} /></span>
          <div>
            <h3 style={{ marginBottom: 2 }}>Fã ADLA</h3>
            <span className="hero-sub" style={{ margin: 0 }}>{address ? shortAddr(address) : 'Modo Demo'}</span>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="section-head">
          <div>
            <p className="eyebrow">ESTATÍSTICAS</p>
            <h3>Sua Jornada</h3>
          </div>
        </div>
        <div className="home-stats-grid">
          <div className="home-stat"><span className="stat-label">Colecionados</span><span className="stat-value">{ownedCount}</span></div>
          <div className="home-stat"><span className="stat-label">Vendidos</span><span className="stat-value">{soldCount}</span></div>
          <div className="home-stat"><span className="stat-label">Ofertas enviadas</span><span className="stat-value">{sentOffersCount}</span></div>
        </div>
        <div className="home-stats-grid" style={{ marginTop: 8 }}>
          <div className="home-stat" style={{ gridColumn: '1 / -1' }}><span className="stat-label">Volume negociado</span><span className="stat-value stat-apy">{formatUsdc(volume)}</span></div>
        </div>
      </section>

      <section className="card">
        <div className="section-head">
          <div>
            <p className="eyebrow">CONFIGURAÇÕES</p>
            <h3>Preferências</h3>
          </div>
        </div>
        <label className="dropdown-item dropdown-toggle" style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
          <span>Modo Demo</span>
          <input type="checkbox" checked={demoMode} onChange={e => onToggleDemo(e.target.checked)} />
        </label>
        <p className="sheet-text" style={{ marginTop: 10 }}>ADLA NFT Market · v1.0 · usa a mesma carteira do ADLA DEFI.</p>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const TABS: { key: ViewKey; label: string; icon: IconName }[] = [
  { key: 'home', label: 'Início', icon: 'home' },
  { key: 'market', label: 'Mercado', icon: 'market' },
  { key: 'collection', label: 'Coleção', icon: 'collection' },
  { key: 'wallet', label: 'Carteira', icon: 'wallet' },
  { key: 'profile', label: 'Perfil', icon: 'profile' },
];

const App: React.FC = () => {
  const provider = useAdlaProvider();
  // Preço SOL/USD real (CoinGecko/Pyth/Birdeye, com cache) — só pra mostrar a
  // estimativa em USD ao lado do preço em USDC. Ainda não afeta o saldo/compra.
  const { price: solUsdPrice } = useSolanaPrice();
  const demoAutoSetRef = useRef(false);

  const [address, setAddress] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [demoMode, setDemoMode] = useState<boolean>(() => !(typeof window !== 'undefined' && window.adlaWallet));
  const [showInstallHint, setShowInstallHint] = useState(false);

  const [activeView, setActiveView] = useState<ViewKey>('home');
  const [status, setStatus] = useState<{ msg: string; type: 'ok' | 'err' | 'loading' } | null>(null);
  const [busy, setBusy] = useState(false);
  const toastTimer = useRef<number | null>(null);

  const [items, setItems] = useState<NftItem[]>(() => genCatalog());
  const [incomingOffers, setIncomingOffers] = useState<IncomingOffer[]>(() =>
    genIncomingOffers().map(o => ({ ...o, mint: items.find(i => i.id === o.itemId)?.mint ?? o.mint }))
  );
  const [activity, setActivity] = useState<ActivityItem[]>(() => genActivity());
  const [adlaBalance, setAdlaBalance] = useState(15400);

  const [soldCount, setSoldCount] = useState(0);
  const [sentOffersCount, setSentOffersCount] = useState(1);
  const [volume, setVolume] = useState(1200);

  const [marketTab, setMarketTab] = useState<MarketTab>('colecionaveis');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [sort, setSort] = useState<SortKey>('recentes');
  const [filterOpen, setFilterOpen] = useState(false);

  const [selectedItem, setSelectedItem] = useState<NftItem | null>(null);
  const [buyConfirming, setBuyConfirming] = useState(false);
  const [offerAmount, setOfferAmount] = useState('');
  const [listPrice, setListPrice] = useState('');

  const setMsg = useCallback((msg: string, type: 'ok' | 'err' | 'loading' = 'ok') => {
    setStatus({ msg, type });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    if (type !== 'loading') toastTimer.current = window.setTimeout(() => setStatus(null), 3200);
  }, []);

  // auto-desativa o Modo Demo na primeira vez que uma carteira real é detectada
  useEffect(() => {
    if (provider && !demoAutoSetRef.current) {
      demoAutoSetRef.current = true;
      setDemoMode(false);
    }
  }, [provider]);

  // assina eventos do provider quando ele existir
  useEffect(() => {
    if (!provider) return;
    const onAccounts = (accs: string[]) => setAddress(accs?.[0] ?? '');
    const onDisconnectEvt = () => setAddress('');
    provider.on('accountsChanged', onAccounts);
    provider.on('disconnect', onDisconnectEvt);
    provider.request<string[]>({ method: 'sol_accounts' }).then(accs => { if (accs?.[0]) setAddress(accs[0]); }).catch(() => {});
    return () => {
      provider.removeListener('accountsChanged', onAccounts);
      provider.removeListener('disconnect', onDisconnectEvt);
    };
  }, [provider]);

  const pushActivity = useCallback((item: Omit<ActivityItem, 'id' | 'ts'>) => {
    setActivity(prev => [{ ...item, id: randomId(), ts: Date.now() }, ...prev].slice(0, 30));
  }, []);

  const connect = useCallback(async () => {
    if (!provider) {
      if (demoMode) {
        setAddress(genDemoAddress());
        setMsg('Conectado em modo demo ✓');
      } else {
        setShowInstallHint(true);
      }
      return;
    }
    setConnecting(true);
    setMsg('Aguardando aprovação na carteira…', 'loading');
    try {
      const accounts = await provider.request<string[]>({ method: 'sol_requestAccounts' });
      setAddress(accounts?.[0] ?? '');
      setMsg('Carteira conectada ✓');
    } catch (e: any) {
      setMsg(e?.message || 'Conexão recusada', 'err');
    } finally {
      setConnecting(false);
    }
  }, [provider, demoMode, setMsg]);

  const disconnect = useCallback(() => {
    setAddress('');
    setMsg('Carteira desconectada');
  }, [setMsg]);

  const ensureConnected = useCallback((): boolean => {
    if (address) return true;
    setMsg('Conecte sua carteira primeiro', 'err');
    if (!provider) setShowInstallHint(true);
    return false;
  }, [address, provider, setMsg]);

  const openItem = useCallback((item: NftItem) => {
    setSelectedItem(item);
    setBuyConfirming(false);
    setOfferAmount('');
    setListPrice('');
  }, []);

  const closeItem = useCallback(() => {
    setSelectedItem(null);
    setBuyConfirming(false);
    setOfferAmount('');
    setListPrice('');
  }, []);

  const toggleLike = useCallback((item: NftItem) => {
    setItems(prev => prev.map(i => (i.id === item.id ? { ...i, liked: !i.liked, likes: i.liked ? i.likes - 1 : i.likes + 1 } : i)));
    setSelectedItem(prev => (prev && prev.id === item.id ? { ...prev, liked: !prev.liked, likes: prev.liked ? prev.likes - 1 : prev.likes + 1 } : prev));
  }, []);

  const requestBuy = useCallback((item: NftItem) => {
    if (!ensureConnected()) return;
    if (!buyConfirming) { setBuyConfirming(true); return; }
    setBuyConfirming(false);
    if (adlaBalance < item.price) { setMsg('Saldo insuficiente', 'err'); return; }
    setBusy(true); setMsg('Confirmando compra…', 'loading');
    (async () => {
      try {
        await callBridge(provider, demoMode, 'adla_nftBuy', [{ mint: item.mint, price: item.price }], () => {
          setItems(prev => prev.map(i => (i.id === item.id ? { ...i, owned: true, forSale: false } : i)));
          setAdlaBalance(b => b - item.price);
          setVolume(v => v + item.price);
        });
        pushActivity({ kind: 'buy', label: `Compra · ${item.title}`, amount: `-${item.price.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`, status: 'confirmed' });
        setMsg('Compra confirmada ✓');
        closeItem();
      } catch (e: any) { setMsg(e?.message || 'Falha na compra', 'err'); }
      finally { setBusy(false); }
    })();
  }, [ensureConnected, buyConfirming, adlaBalance, provider, demoMode, setMsg, pushActivity, closeItem]);

  const handleOffer = useCallback(async (item: NftItem, amount: number) => {
    if (!ensureConnected()) return;
    if (!amount || amount <= 0) { setMsg('Informe um valor válido', 'err'); return; }
    setBusy(true); setMsg('Enviando oferta…', 'loading');
    try {
      await callBridge(provider, demoMode, 'adla_nftMakeOffer', [{ mint: item.mint, amount }], () => {
        setSentOffersCount(c => c + 1);
      });
      pushActivity({ kind: 'offer', label: `Oferta enviada · ${item.title}`, amount: `${amount.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`, status: 'pending' });
      setMsg('Oferta enviada ✓');
      closeItem();
    } catch (e: any) { setMsg(e?.message || 'Falha ao enviar oferta', 'err'); }
    finally { setBusy(false); }
  }, [ensureConnected, provider, demoMode, setMsg, pushActivity, closeItem]);

  const handleList = useCallback(async (item: NftItem, price: number) => {
    if (!ensureConnected()) return;
    if (!price || price <= 0) { setMsg('Informe um preço válido', 'err'); return; }
    setBusy(true); setMsg('Listando item…', 'loading');
    try {
      await callBridge(provider, demoMode, 'adla_nftList', [{ mint: item.mint, price }], () => {
        setItems(prev => prev.map(i => (i.id === item.id ? { ...i, forSale: true, price } : i)));
      });
      pushActivity({ kind: 'list', label: `Listado para venda · ${item.title}`, amount: `${price.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`, status: 'confirmed' });
      setMsg('Item listado para venda ✓');
      closeItem();
    } catch (e: any) { setMsg(e?.message || 'Falha ao listar item', 'err'); }
    finally { setBusy(false); }
  }, [ensureConnected, provider, demoMode, setMsg, pushActivity, closeItem]);

  const handleUnlist = useCallback(async (item: NftItem) => {
    if (!ensureConnected()) return;
    setBusy(true); setMsg('Removendo da venda…', 'loading');
    try {
      await callBridge(provider, demoMode, 'adla_nftUnlist', [{ mint: item.mint }], () => {
        setItems(prev => prev.map(i => (i.id === item.id ? { ...i, forSale: false } : i)));
      });
      pushActivity({ kind: 'unlist', label: `Removido da venda · ${item.title}`, status: 'confirmed' });
      setMsg('Removido da venda ✓');
      closeItem();
    } catch (e: any) { setMsg(e?.message || 'Falha ao remover da venda', 'err'); }
    finally { setBusy(false); }
  }, [ensureConnected, provider, demoMode, setMsg, pushActivity, closeItem]);

  const handleAcceptOffer = useCallback(async (offer: IncomingOffer) => {
    if (!ensureConnected()) return;
    setBusy(true); setMsg('Aceitando oferta…', 'loading');
    try {
      await callBridge(provider, demoMode, 'adla_nftAcceptOffer', [{ mint: offer.mint, buyerAddress: offer.buyerAddress }], () => {
        setItems(prev => prev.map(i => (i.id === offer.itemId ? { ...i, owned: false, forSale: false } : i)));
        setIncomingOffers(prev => prev.filter(o => o.id !== offer.id));
        setAdlaBalance(b => b + offer.amount);
        setSoldCount(c => c + 1);
        setVolume(v => v + offer.amount);
      });
      pushActivity({ kind: 'sell', label: `Venda aceita · ${offer.itemTitle}`, amount: `+${offer.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`, status: 'confirmed' });
      setMsg('Oferta aceita, item vendido ✓');
    } catch (e: any) { setMsg(e?.message || 'Falha ao aceitar oferta', 'err'); }
    finally { setBusy(false); }
  }, [ensureConnected, provider, demoMode, setMsg, pushActivity]);

  const handleDeclineOffer = useCallback(async (offer: IncomingOffer) => {
    if (!ensureConnected()) return;
    setBusy(true); setMsg('Recusando oferta…', 'loading');
    try {
      await callBridge(provider, demoMode, 'adla_nftDeclineOffer', [{ mint: offer.mint, buyerAddress: offer.buyerAddress }], () => {
        setIncomingOffers(prev => prev.filter(o => o.id !== offer.id));
      });
      pushActivity({ kind: 'decline', label: `Oferta recusada · ${offer.itemTitle}`, status: 'confirmed' });
      setMsg('Oferta recusada');
    } catch (e: any) { setMsg(e?.message || 'Falha ao recusar oferta', 'err'); }
    finally { setBusy(false); }
  }, [ensureConnected, provider, demoMode, setMsg, pushActivity]);

  const ownedItems = useMemo(() => items.filter(i => i.owned), [items]);
  const featuredItems = useMemo(() => items.filter(i => i.featured), [items]);
  const collectionValue = useMemo(() => ownedItems.reduce((s, i) => s + (i.listingMode === 'unlisted' ? 0 : i.price), 0), [ownedItems]);

  const marketItems = useMemo(() => {
    let list = marketTab === 'venda' ? items.filter(i => i.owned) : items;
    if (category !== 'all') list = list.filter(i => i.category === category);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(i => i.title.toLowerCase().includes(q) || i.tags.some(t => t.toLowerCase().includes(q)));
    }
    const sorted = [...list];
    if (sort === 'preco_asc') sorted.sort((a, b) => a.price - b.price);
    else if (sort === 'preco_desc') sorted.sort((a, b) => b.price - a.price);
    else if (sort === 'populares') sorted.sort((a, b) => b.likes - a.likes);
    return sorted;
  }, [items, marketTab, category, search, sort]);

  const statusLabel = provider && !demoMode
    ? (address ? 'Conectado à L3' : 'Carteira detectada')
    : demoMode ? 'Modo Demo' : 'Carteira não detectada';

  return (
    <SolUsdContext.Provider value={solUsdPrice}>
    <div className="adla-app">
      <div className="bg-aurora" aria-hidden="true" />

      <div className="app-shell">
        <header className="app-header">
          <div className="brand" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Logo: coloque o arquivo em src/assets/logo.png.
               Importar como módulo (linha do import lá em cima) é mais seguro que usar
               um caminho tipo "/logo.png" ou "./logo.png": o Vite gera a URL final certa
               em build, considerando o `base` do vite.config.ts — não depende da URL
               atual do navegador nem quebra se o app navegar pra outra "página". */}
            <img
              src={logoUrl}
              alt="ADLA NFT Market"
              className="brand-logo"
              style={{ width: 32, height: 32, borderRadius: 8, objectFit: 'cover' }}
            />
            <div className="brand-text" style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
              <span className="brand-mark">ADLA NFT</span>
              <span className="brand-sub">FANDOM COLLECTIBLES</span>
            </div>
          </div>
          <WalletButton
            hasProvider={!!provider}
            address={address}
            connecting={connecting}
            demoMode={demoMode}
            onConnect={connect}
            onDisconnect={disconnect}
            onToggleDemo={setDemoMode}
          />
        </header>

        <div className="ticket-perf" aria-hidden="true" />

        <div className="ticker-strip">
          <span className={`live-dot ${provider && !demoMode ? 'is-live' : 'is-demo'}`} />
          <span className="ticker-static">{statusLabel}</span>
          <div className="ticker-marquee" aria-hidden="true">
            <span>
              🎴 NOVA CARTA HOLOGRÁFICA ENCORE CHEGANDO&nbsp;&nbsp;&nbsp;&nbsp;
              💎 LEILÃO DO PASSE DE BASTIDORES EM BREVE&nbsp;&nbsp;&nbsp;&nbsp;
              🔥 VAULTS ESTRATÉGICOS COM OFERTA LIMITADA&nbsp;&nbsp;&nbsp;&nbsp;
            </span>
          </div>
        </div>

        {status && (
          <div className={`status-toast status-${status.type}`}>
            <Icon name="sparkle" size={14} spin={status.type === 'loading'} />
            {status.msg}
          </div>
        )}

        <nav className="tab-nav" role="tablist" aria-label="Seções do app">
          {TABS.map(t => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={activeView === t.key}
              className={`tab-btn ${activeView === t.key ? 'tab-active' : ''}`}
              onClick={() => setActiveView(t.key)}
            >
              <Icon name={t.icon} size={20} />
              <span>{t.label}</span>
            </button>
          ))}
        </nav>

        <main className="view">
          {activeView === 'home' && (
            <HomeView
              ownedCount={ownedItems.length}
              forSaleCount={items.filter(i => i.forSale).length}
              collectionValue={collectionValue}
              adlaBalance={adlaBalance}
              offersCount={incomingOffers.length}
              featured={featuredItems}
              onOpen={openItem}
              onToggleLike={toggleLike}
              onGoMarket={() => setActiveView('market')}
              onGoCollection={() => setActiveView('collection')}
              onGoSell={() => { setMarketTab('venda'); setActiveView('market'); }}
            />
          )}
          {activeView === 'market' && (
            <MarketView
              items={marketItems}
              marketTab={marketTab}
              onMarketTab={setMarketTab}
              search={search}
              onSearch={setSearch}
              onOpenFilter={() => setFilterOpen(true)}
              category={category}
              sort={sort}
              incomingOffers={incomingOffers}
              busy={busy}
              onOpen={openItem}
              onToggleLike={toggleLike}
              onAcceptOffer={handleAcceptOffer}
              onDeclineOffer={handleDeclineOffer}
            />
          )}
          {activeView === 'collection' && (
            <CollectionView items={ownedItems} onOpen={openItem} onToggleLike={toggleLike} />
          )}
          {activeView === 'wallet' && (
            <WalletView address={address} adlaBalance={adlaBalance} ownedItems={ownedItems} activity={activity} />
          )}
          {activeView === 'profile' && (
            <ProfileView
              address={address}
              demoMode={demoMode}
              onToggleDemo={setDemoMode}
              ownedCount={ownedItems.length}
              soldCount={soldCount}
              sentOffersCount={sentOffersCount}
              volume={volume}
            />
          )}
        </main>
      </div>

      <ItemSheet
        item={selectedItem}
        open={!!selectedItem}
        onClose={closeItem}
        busy={busy}
        adlaBalance={adlaBalance}
        offerAmount={offerAmount}
        onOfferAmount={setOfferAmount}
        listPrice={listPrice}
        onListPrice={setListPrice}
        buyConfirming={buyConfirming}
        onRequestBuy={requestBuy}
        onOffer={handleOffer}
        onList={handleList}
        onUnlist={handleUnlist}
        onToggleLike={toggleLike}
      />

      <FilterSheet
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        category={category}
        onCategory={setCategory}
        sort={sort}
        onSort={setSort}
      />

      <InstallHintSheet
        open={showInstallHint}
        onClose={() => setShowInstallHint(false)}
        onDemo={() => {
          setDemoMode(true);
          setShowInstallHint(false);
          setAddress(genDemoAddress());
          setMsg('Conectado em modo demo ✓');
        }}
      />
    </div>
    </SolUsdContext.Provider>
  );
};

export default App;