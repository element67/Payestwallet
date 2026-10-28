import { NetworkArbitrumOne, NetworkArc, NetworkAvalanche, NetworkBase, NetworkEthereum, NetworkOptimism, TokenETH, TokenEURC, TokenUSDC } from '@web3icons/react'

export function TokenIcon({ symbol, size = 36 }: { symbol: string; size?: number }) {
  if (symbol === 'USDC') return <TokenUSDC variant="branded" size={size} />
  if (symbol === 'EURC') return <TokenEURC variant="branded" size={size} />
  if (symbol === 'ETH') return <TokenETH variant="branded" size={size} />
  return (
    <span className="grid place-items-center rounded-full bg-brand-100 font-bold text-brand-700" style={{ width: size, height: size, fontSize: size / 3 }}>
      {symbol.slice(0, 2)}
    </span>
  )
}

export function ChainIcon({ chainId, size = 24 }: { chainId: number; size?: number }) {
  switch (chainId) {
    case 5042002:
      return <NetworkArc variant="branded" size={size} />
    case 11155111:
      return <NetworkEthereum variant="branded" size={size} />
    case 84532:
      return <NetworkBase variant="branded" size={size} />
    case 421614:
      return <NetworkArbitrumOne variant="branded" size={size} />
    case 11155420:
      return <NetworkOptimism variant="branded" size={size} />
    case 43113:
      return <NetworkAvalanche variant="branded" size={size} />
    default:
      return <span className="rounded-full bg-brand-100" style={{ width: size, height: size }} />
  }
}
