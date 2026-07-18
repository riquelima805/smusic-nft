/**
 * TensorMarket.demo.tsx
 * 
 * Demo rápida para testar:
 * - Carregamento de Tensor Trade
 * - Preço SOL/USD
 * - Conversão de valores
 * - UI com preços em USD
 * 
 * Use como componente temporário ou teste
 */

import React, { useState, useEffect } from 'react';
import { useTensorMarket, useSolanaPrice, useSolanaConversion } from './useTensorMarket';

function App() {
  const { items, loading, error, lastRefresh, refresh } = useTensorMarket();
  const { price: solPrice } = useSolanaPrice();
  const conversion = useSolanaConversion();

  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [usdValue, setUsdValue] = useState('0.00');
  const [solValue, setSolValue] = useState('0.00');

  // Quando item é selecionado, mostrar preço em USD
  useEffect(() => {
    if (!selectedItem) return;

    (async () => {
      const usd = await conversion.formatLamportsAsUsd(
        selectedItem.tensorPrice,
        2
      );
      setUsdValue(usd);
    })();
  }, [selectedItem, conversion]);

  const handleSolInput = async (val: string) => {
    setSolValue(val);
    if (!val) return;

    try {
      const sol = parseFloat(val);
      if (isNaN(sol)) return;

      const usd = await conversion.solToUsd(sol);
      setUsdValue(usd.toFixed(2));
    } catch (e) {
      console.error('Erro ao converter:', e);
    }
  };

  const handleUsdInput = async (val: string) => {
    setUsdValue(val);
    if (!val) return;

    try {
      const usd = parseFloat(val);
      if (isNaN(usd)) return;

      const sol = await conversion.usdToSol(usd);
      setSolValue(sol.toFixed(4));
    } catch (e) {
      console.error('Erro ao converter:', e);
    }
  };

  return (
    <div style={styles.container}>
      <h1>🎨 Demo: Tensor Trade Market</h1>

      {/* STATUS */}
      <div style={styles.statusBar}>
        <div style={styles.statusItem}>
          <span>📊 Preço SOL/USD:</span>
          <strong>${solPrice?.toFixed(2) || '...'}</strong>
        </div>
        <div style={styles.statusItem}>
          <span>📡 Últimas listagens:</span>
          <strong>
            {lastRefresh > 0
              ? new Date(lastRefresh).toLocaleTimeString()
              : 'Não carregado'}
          </strong>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          style={styles.btnRefresh}
        >
          {loading ? '⏳ Carregando...' : '🔄 Atualizar'}
        </button>
      </div>

      {/* CONVERSOR */}
      <div style={styles.converter}>
        <h3>💱 Conversor SOL ↔ USD</h3>
        <div style={styles.converterRow}>
          <div style={styles.converterField}>
            <label>SOL</label>
            <input
              type="number"
              value={solValue}
              onChange={(e) => handleSolInput(e.target.value)}
              placeholder="0.00"
              style={styles.input}
            />
          </div>
          <div style={styles.converterSpacer}>⇄</div>
          <div style={styles.converterField}>
            <label>USD</label>
            <input
              type="number"
              value={usdValue}
              onChange={(e) => handleUsdInput(e.target.value)}
              placeholder="0.00"
              style={styles.input}
            />
          </div>
        </div>
      </div>

      {/* ERRO */}
      {error && (
        <div style={styles.errorBox}>
          ❌ Erro ao carregar: {error}
        </div>
      )}

      {/* LOADING */}
      {loading && !items.length && (
        <div style={styles.loadingBox}>
          ⏳ Carregando listagens do Tensor Trade...
        </div>
      )}

      {/* LISTAGENS */}
      <div style={styles.listingsContainer}>
        <h2>📦 Listagens ({items.length})</h2>

        {items.length === 0 && !loading && (
          <p style={styles.empty}>Nenhum NFT listado encontrado</p>
        )}

        <div style={styles.grid}>
          {items.map((item) => (
            <div
              key={item.tensorMint}
              style={{
                ...styles.card,
                ...(selectedItem?.tensorMint === item.tensorMint
                  ? styles.cardSelected
                  : {}),
              }}
              onClick={() => setSelectedItem(item)}
            >
              {/* Imagem */}
              {item.tensorImage ? (
                <img
                  src={item.tensorImage}
                  alt={item.tensorName}
                  style={styles.cardImage}
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              ) : (
                <div style={styles.cardImagePlaceholder}>🖼️</div>
              )}

              {/* Info */}
              <div style={styles.cardInfo}>
                <h3 style={styles.cardTitle}>{item.tensorName}</h3>

                {/* Rarity */}
                {item.tensorRarity && (
                  <p style={styles.rarity}>
                    Rank #{item.tensorRarity}
                  </p>
                )}

                {/* Preço SOL */}
                <p style={styles.priceSol}>
                  {(item.tensorPrice / 1_000_000_000).toFixed(2)} SOL
                </p>

                {/* Preço USD ✨ */}
                <p style={styles.priceUsd}>
                  ${item.tensorPriceUsd.toFixed(2)} USD
                </p>

                {/* Seller */}
                {item.tensorSeller && (
                  <p style={styles.seller}>
                    Vendedor: {item.tensorSeller.slice(0, 8)}...
                  </p>
                )}
              </div>

              {/* Botão Comprar */}
              <button
                style={styles.btnBuy}
                onClick={(e) => {
                  e.stopPropagation();
                  alert(
                    `Comprar ${item.tensorName} por ${item.tensorPriceUsd.toFixed(2)} USD? (Demo apenas)`
                  );
                }}
              >
                🛒 Comprar
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* ITEM SELECIONADO */}
      {selectedItem && (
        <div style={styles.detailPanel}>
          <h2>📋 Detalhes</h2>
          <table style={styles.detailTable}>
            <tbody>
              <tr>
                <td>Nome:</td>
                <td>{selectedItem.tensorName}</td>
              </tr>
              <tr>
                <td>Mint:</td>
                <td style={styles.mono}>{selectedItem.tensorMint}</td>
              </tr>
              <tr>
                <td>Preço (SOL):</td>
                <td>
                  {(selectedItem.tensorPrice / 1_000_000_000).toFixed(4)} SOL
                </td>
              </tr>
              <tr>
                <td>Preço (USD):</td>
                <td style={styles.priceUsdDetail}>
                  ${selectedItem.tensorPriceUsd.toFixed(2)}
                </td>
              </tr>
              <tr>
                <td>Preço (Lamports):</td>
                <td style={styles.mono}>{selectedItem.tensorPrice}</td>
              </tr>
              <tr>
                <td>Listado:</td>
                <td>{selectedItem.tensorListed ? '✅ Sim' : '❌ Não'}</td>
              </tr>
              {selectedItem.tensorRarity && (
                <tr>
                  <td>Rarity Rank:</td>
                  <td>#{selectedItem.tensorRarity}</td>
                </tr>
              )}
              <tr>
                <td>Última atualização:</td>
                <td>
                  {new Date(selectedItem.lastUpdated).toLocaleTimeString()}
                </td>
              </tr>
            </tbody>
          </table>
          <button
            onClick={() => setSelectedItem(null)}
            style={styles.btnClose}
          >
            Fechar
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// ESTILOS
// ============================================================================

const styles = {
  container: {
    maxWidth: '1400px',
    margin: '0 auto',
    padding: '20px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    background: 'linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)',
    minHeight: '100vh',
  } as React.CSSProperties,

  statusBar: {
    display: 'flex',
    gap: '20px',
    alignItems: 'center',
    padding: '15px',
    background: 'white',
    borderRadius: '8px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
    marginBottom: '20px',
  } as React.CSSProperties,

  statusItem: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '5px',
  },

  btnRefresh: {
    padding: '10px 20px',
    background: '#4CAF50',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: 'bold',
    transition: 'all 0.3s',
  } as React.CSSProperties,

  converter: {
    background: 'white',
    padding: '20px',
    borderRadius: '8px',
    marginBottom: '20px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
  } as React.CSSProperties,

  converterRow: {
    display: 'flex',
    gap: '20px',
    alignItems: 'flex-end',
    marginTop: '15px',
  } as React.CSSProperties,

  converterField: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '5px',
  },

  converterSpacer: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: '#2196F3',
  },

  input: {
    padding: '10px',
    border: '1px solid #ddd',
    borderRadius: '6px',
    fontSize: '16px',
    fontFamily: 'monospace',
  } as React.CSSProperties,

  errorBox: {
    padding: '15px',
    background: '#ffebee',
    border: '1px solid #ef5350',
    borderRadius: '6px',
    color: '#c62828',
    marginBottom: '20px',
  } as React.CSSProperties,

  loadingBox: {
    padding: '20px',
    textAlign: 'center' as const,
    color: '#666',
    fontStyle: 'italic',
  },

  listingsContainer: {
    background: 'white',
    padding: '20px',
    borderRadius: '8px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
  } as React.CSSProperties,

  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
    gap: '15px',
    marginTop: '15px',
  } as React.CSSProperties,

  card: {
    border: '2px solid #e0e0e0',
    borderRadius: '8px',
    overflow: 'hidden',
    cursor: 'pointer',
    transition: 'all 0.3s',
    display: 'flex',
    flexDirection: 'column' as const,
    background: '#fafafa',
  } as React.CSSProperties,

  cardSelected: {
    borderColor: '#2196F3',
    boxShadow: '0 4px 12px rgba(33,150,243,0.3)',
    background: '#f0f8ff',
  } as React.CSSProperties,

  cardImage: {
    width: '100%',
    height: '180px',
    objectFit: 'cover' as const,
    background: '#f0f0f0',
  } as React.CSSProperties,

  cardImagePlaceholder: {
    width: '100%',
    height: '180px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '48px',
    background: '#f0f0f0',
  } as React.CSSProperties,

  cardInfo: {
    padding: '15px',
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '8px',
  },

  cardTitle: {
    margin: '0',
    fontSize: '14px',
    fontWeight: 'bold',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },

  rarity: {
    margin: '0',
    fontSize: '12px',
    color: '#666',
  },

  priceSol: {
    margin: '0',
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#1976D2',
  },

  priceUsd: {
    margin: '0',
    fontSize: '18px',
    fontWeight: 'bold',
    color: '#4CAF50',
  } as React.CSSProperties,

  priceUsdDetail: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#4CAF50',
  },

  seller: {
    margin: '0',
    fontSize: '11px',
    color: '#999',
    fontFamily: 'monospace',
  },

  btnBuy: {
    padding: '10px',
    background: '#2196F3',
    color: 'white',
    border: 'none',
    cursor: 'pointer',
    fontWeight: 'bold',
    transition: 'background 0.3s',
  } as React.CSSProperties,

  detailPanel: {
    marginTop: '20px',
    padding: '20px',
    background: 'white',
    borderRadius: '8px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
  } as React.CSSProperties,

  detailTable: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    marginTop: '15px',
  } as React.CSSProperties,

  mono: {
    fontFamily: 'monospace',
    fontSize: '12px',
    color: '#666',
  },

  btnClose: {
    marginTop: '15px',
    padding: '10px 20px',
    background: '#666',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
  } as React.CSSProperties,

  empty: {
    textAlign: 'center' as const,
    color: '#999',
    fontStyle: 'italic',
    padding: '20px',
  },
};

export default App;