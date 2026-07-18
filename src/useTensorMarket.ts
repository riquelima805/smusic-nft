/**
 * useTensorMarket.ts
 * 
 * Hook React que:
 * 1. Carrega listagens do Tensor Trade
 * 2. Converte preços para USD
 * 3. Mapeia dados para formato ADLA NftItem
 * 4. Gerencia refresh e cache
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { tensorAdapter } from './TensorTradeAdapter';
import type { TensorNFT } from './TensorTradeAdapter';
import { solanaPrice } from './SolanaPriceService';

export interface TensorMarketItem {
  tensorMint: string;
  tensorName: string;
  tensorImage?: string;
  tensorPrice: number; // em lamports
  tensorPriceUsd: number;
  tensorSeller?: string;
  tensorRarity?: number;
  tensorListed: boolean;
  lastUpdated: number;
}

interface UseHookState {
  items: TensorMarketItem[];
  loading: boolean;
  error: string | null;
  lastRefresh: number;
}

export function useTensorMarket() {
  const [state, setState] = useState<UseHookState>({
    items: [],
    loading: true,
    error: null,
    lastRefresh: 0,
  });

  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isUnmountedRef = useRef(false);

  /**
   * Converte dados Tensor para formato ADLA
   */
  const convertTensorNft = async (nft: TensorNFT): Promise<TensorMarketItem | null> => {
    try {
      if (!nft.listed || !nft.listedPrice) {
        return null; // Pula não-listados
      }

      const usdPrice = await solanaPrice.lamportsToUsd(nft.listedPrice);

      return {
        tensorMint: nft.mint,
        tensorName: nft.name || 'Unnamed NFT',
        tensorImage: nft.image,
        tensorPrice: nft.listedPrice,
        tensorPriceUsd: usdPrice,
        tensorSeller: nft.owner,
        tensorRarity: nft.rarityRank,
        tensorListed: true,
        lastUpdated: Date.now(),
      };
    } catch (error) {
      console.error('Erro ao converter NFT:', error);
      return null;
    }
  };

  /**
   * Carrega listings do Tensor Trade
   */
  const loadListings = useCallback(async () => {
    if (isUnmountedRef.current) return;

    setState(s => ({ ...s, loading: true, error: null }));

    try {
      console.log('📡 Carregando listagens do Tensor Trade...');

      // Busca dados
      const listings = await tensorAdapter.fetchListings();

      if (isUnmountedRef.current) return;

      if (!listings || listings.length === 0) {
        setState(s => ({
          ...s,
          items: [],
          loading: false,
          lastRefresh: Date.now(),
        }));
        return;
      }

      // Converte cada NFT
      const converted = await Promise.all(
        listings.map(nft => convertTensorNft(nft))
      );

      if (isUnmountedRef.current) return;

      const validItems = converted.filter(Boolean) as TensorMarketItem[];

      console.log(
        `✓ Carregados ${validItems.length} NFTs do Tensor Trade`
      );

      setState(s => ({
        ...s,
        items: validItems,
        loading: false,
        lastRefresh: Date.now(),
      }));
    } catch (error: any) {
      if (isUnmountedRef.current) return;

      const errorMsg = error?.message || 'Erro ao carregar listings';
      console.error('❌ Falha ao carregar Tensor Trade:', errorMsg);

      setState(s => ({
        ...s,
        loading: false,
        error: errorMsg,
      }));
    }
  }, []);

  /**
   * Carrega na montagem e setup auto-refresh
   */
  useEffect(() => {
    isUnmountedRef.current = false;

    // First load
    loadListings();

    // Auto-refresh a cada 5 minutos
    refreshTimeoutRef.current = setInterval(() => {
      if (!isUnmountedRef.current) {
        console.log('🔄 Auto-refresh de Tensor Trade...');
        loadListings();
      }
    }, 5 * 60_000);

    return () => {
      isUnmountedRef.current = true;
      if (refreshTimeoutRef.current) {
        clearInterval(refreshTimeoutRef.current);
      }
    };
  }, [loadListings]);

  return {
    items: state.items,
    loading: state.loading,
    error: state.error,
    lastRefresh: state.lastRefresh,
    refresh: loadListings, // Manual refresh
  };
}

/**
 * Hook para buscar preço SOL/USD
 */
export function useSolanaPrice() {
  const [price, setPrice] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const fetchPrice = async () => {
      try {
        const data = await solanaPrice.fetchPrice();
        if (mounted) {
          setPrice(data.solUsd);
          setError(null);
        }
      } catch (err: any) {
        if (mounted) {
          setError(err?.message || 'Erro ao buscar preço');
          setPrice(null);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    fetchPrice();

    // Refresh a cada 5 min
    const interval = setInterval(() => {
      if (mounted) fetchPrice();
    }, 5 * 60_000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  return { price, loading, error };
}

/**
 * Hook para converter valores SOL ↔ USD
 */
export function useSolanaConversion() {
  return {
    solToUsd: async (sol: number) => solanaPrice.solToUsd(sol),
    usdToSol: async (usd: number) => solanaPrice.usdToSol(usd),
    lamportsToUsd: async (lamports: number) =>
      solanaPrice.lamportsToUsd(lamports),
    usdToLamports: async (usd: number) => solanaPrice.usdToLamports(usd),
    formatLamportsAsUsd: async (lamports: number, decimals = 2) =>
      solanaPrice.formatLamportsAsUsd(lamports, decimals),
    formatSolAsUsd: async (sol: number, decimals = 2) =>
      solanaPrice.formatSolAsUsd(sol, decimals),
  };
}
