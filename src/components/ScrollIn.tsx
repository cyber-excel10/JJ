'use client'

import React, { useState, useCallback } from 'react'
import { connect as connectStarknet } from 'starknetkit'
import { RpcProvider, Contract, uint256 } from 'starknet'
import {
  StellarWalletsKit,
  WalletNetwork,
  XBULL_ID,
} from '@creit.tech/stellar-wallets-kit'
import {
  WalletConnectAllowedMethods,
  WalletConnectModule,
} from '@creit.tech/stellar-wallets-kit/modules/walletconnect.module'
import {
  xBullModule,
  FreighterModule,
  AlbedoModule,
} from '@creit.tech/stellar-wallets-kit'

import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Card,
  CardAction,
  CardDescription,
  CardContent,
  CardTitle,
  CardHeader,
  CardFooter
} from '@/components/ui/card'
import { Progress } from "@/components/ui/progress"
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { BorderBeam } from '@/components/magicui/border-beam'
import { Loader2, CheckCircle, AlertCircle } from 'lucide-react'

interface TokenInfo {
  address: string
  decimals: number
  symbol: string
}

interface Balances {
  [symbol: string]: number
}

interface StellarBalance {
  asset_type: string
  asset_code?: string
  balance: string
}

interface DustBalance {
  id: string
  asset: string
  symbol: string
  amount: number
  usdValue: number
  network: 'starknet' | 'stellar'
}

// interface SwapChain {
//   pool_address: string
//   token_a: string
//   token_b: string
//   fee_bps: number
// }

interface BatchGroup {
  assets: DustBalance[]
  totalValue: number
  batchId: number
}

interface BatchResult {
  batchId: number
  success: boolean
  targetAsset?: string
  totalReceived?: number
  assetsProcessed: number
  originalValue: number
  error?: string
}

interface TransferResult {
  asset: string
  amount: number
  success: boolean
  txHash: string
}

interface ProcessingResults {
  batchResults: BatchResult[]
  transferResults: TransferResult[]
  totalBatches: number
  successfulBatches: number
}

interface WalletLike {
  selectedAddress?: string
  selectedAccount?: { address: string }
  account?: { address: string }
}

interface StarknetContract {
  balanceOf: (address: string) => Promise<{ balance: unknown }>
}

// Stellar Contract Interface
interface StellarContract {
  address: string
  network: WalletNetwork
}

const TOKENS: Record<string, TokenInfo> = {
  ETH: {
    address: '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7',
    decimals: 18,
    symbol: 'ETH',
  },
  STRK: {
    address: '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d',
    decimals: 18,
    symbol: 'STRK',
  },
  USDC: {
    address: '0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8',
    decimals: 6,
    symbol: 'USDC',
  },
  USDT: {
    address: '0x068f5c6a61780768455de69077e07e89787839bf8166decfbf92b645209c0fb8',
    decimals: 6,
    symbol: 'USDT',
  },
  DAI: {
    address: '0x00da114221cb83fa859dbdb4c44beeaa0bb37c7537ad5ae66fe5e0efd20e6eb3',
    decimals: 18,
    symbol: 'DAI',
  },
  WBTC: {
    address: '0x012d537dc323c439dc65c976fad242d5610d27cfb5f31689a0a319b8be7f3d56',
    decimals: 8,
    symbol: 'WBTC',
  },
}

const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    inputs: [{ name: 'account', type: 'felt' }],
    outputs: [{ name: 'balance', type: 'Uint256' }],
  },
]

// Fixed contract address - properly defined
const DUST_AGGREGATOR_CONTRACT = 'CAENNM2HHYAKX4V3LSQM4BEPHZ6DUSPSGPQOW6QXDY5FOHB2HMB6TMNX'

const ProcessingStep = {
  IDLE: 0,
  COLLECTING_DUST: 1,
  OPTIMIZING_BATCH: 2,
  PROCESSING_BATCH: 3,
  TRANSFERRING: 4,
  COMPLETE: 5
} as const

type ProcessingStepType = typeof ProcessingStep[keyof typeof ProcessingStep]

const stepLabels: Record<ProcessingStepType, string> = {
  [ProcessingStep.IDLE]: 'Idle',
  [ProcessingStep.COLLECTING_DUST]: 'Collecting dust from connected wallets',
  [ProcessingStep.OPTIMIZING_BATCH]: 'Optimizing batch transactions',
  [ProcessingStep.PROCESSING_BATCH]: 'Processing batch transactions',
  [ProcessingStep.TRANSFERRING]: 'Transferring via Stellar contract',
  [ProcessingStep.COMPLETE]: 'Complete',
}

let stellarWalletKit: StellarWalletsKit | null = null

// Get a valid WalletConnect project ID from https://cloud.walletconnect.com
const WALLETCONNECT_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || '2f05a7cde26b5eebb89f0a82b4b95e25'

function initStellarKit(): StellarWalletsKit {
  if (stellarWalletKit) return stellarWalletKit
  
  const modules = [
    new xBullModule(),
    new FreighterModule(),
    new AlbedoModule(),
  ]

  // Only add WalletConnect if we have a valid project ID
  if (WALLETCONNECT_PROJECT_ID && WALLETCONNECT_PROJECT_ID !== 'your-walletconnect-project-id') {
    modules.push(new WalletConnectModule({
      url: typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000',
      projectId: WALLETCONNECT_PROJECT_ID,
      method: WalletConnectAllowedMethods.SIGN,
      description: 'Connect your Stellar wallet to interact with our dApp',
      name: 'Dust Aggregator',
      icons: ['https://stellar.org/favicon.ico'],
      network: WalletNetwork.TESTNET,
    }))
  }

  stellarWalletKit = new StellarWalletsKit({
    network: WalletNetwork.TESTNET,
    selectedWalletId: XBULL_ID,
    modules,
  })
  return stellarWalletKit
}

// Helper function to create Stellar contract instance
const createStellarContract = (address: string): StellarContract => {
  return {
    address,
    network: WalletNetwork.TESTNET
  }
}

// Core dust aggregation logic - Fixed version
const useDustAggregator = (
  starknetContract: StarknetContract | null, 
  stellarContract: StellarContract | null,
  userAddress: string | null, 
  dustBalances: DustBalance[]
) => {
  const [currentStep, setCurrentStep] = useState<ProcessingStepType>(ProcessingStep.IDLE)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [batchTransactions, setBatchTransactions] = useState<BatchGroup[]>([])
  const [processedResults, setProcessedResults] = useState<BatchResult[]>([])

  // Step 1: Collect dust balances (using existing wallet/balance data)
  const collectDust = useCallback(async (): Promise<DustBalance[]> => {
    if (!dustBalances || dustBalances.length === 0) {
      throw new Error('No dust balances selected')
    }

    // Filter out balances below minimum threshold
    const validBalances = dustBalances.filter(balance => {
      const usdValue = balance.usdValue || 0
      return usdValue > 0.01 // $0.01 minimum
    })

    if (validBalances.length === 0) {
      throw new Error('No valid dust balances meet minimum threshold')
    }

    return validBalances
  }, [dustBalances])

  // Step 2: Optimize batch transactions for gas efficiency
  const optimizeBatch = useCallback(async (balances: DustBalance[]): Promise<BatchGroup[]> => {
    const batchGroups: BatchGroup[] = []
    const sortedBalances = [...balances].sort((a, b) => (b.usdValue || 0) - (a.usdValue || 0))
    
    let currentBatch: DustBalance[] = []
    let currentBatchValue = 0
    const MAX_BATCH_VALUE = 100 // $100 max per batch
    const MAX_BATCH_SIZE = 5 // 5 assets max per batch

    for (const balance of sortedBalances) {
      const balanceValue = balance.usdValue || 0
      
      // Start new batch if current would exceed limits
      if (currentBatch.length >= MAX_BATCH_SIZE || 
          (currentBatch.length > 0 && currentBatchValue + balanceValue > MAX_BATCH_VALUE)) {
        batchGroups.push({
          assets: [...currentBatch],
          totalValue: currentBatchValue,
          batchId: batchGroups.length + 1
        })
        currentBatch = []
        currentBatchValue = 0
      }
      
      currentBatch.push(balance)
      currentBatchValue += balanceValue
    }

    // Add remaining assets as final batch
    if (currentBatch.length > 0) {
      batchGroups.push({
        assets: [...currentBatch],
        totalValue: currentBatchValue,
        batchId: batchGroups.length + 1
      })
    }

    setBatchTransactions(batchGroups)
    return batchGroups
  }, [])

  // Step 3: Process batch transactions through smart contract
  const processBatch = useCallback(async (batchGroups: BatchGroup[]): Promise<BatchResult[]> => {
    // Check if we have either contract type available
    if (!starknetContract && !stellarContract) {
      throw new Error('No contract instance available')
    }

    if (!userAddress) {
      throw new Error('User address not available')
    }

    const results: BatchResult[] = []

    for (const batch of batchGroups) {
      try {
        // Find the asset with highest USD value as target
        const targetAsset = batch.assets.reduce((prev: DustBalance, current: DustBalance) => 
          (prev.usdValue || 0) > (current.usdValue || 0) ? prev : current
        )

        // Determine which contract to use based on the batch assets
        const hasStellarAssets = batch.assets.some(asset => asset.network === 'stellar')
        const hasStarknetAssets = batch.assets.some(asset => asset.network === 'starknet')

        if (hasStellarAssets && stellarContract) {
          // Use Stellar contract for Stellar assets
          console.log(`Processing Stellar batch ${batch.batchId} with contract ${stellarContract.address}`)
          
          // Here you would implement the actual Stellar contract call
          // For now, we'll simulate the processing
          await new Promise(resolve => setTimeout(resolve, 1500))
          
          results.push({
            batchId: batch.batchId,
            success: true,
            targetAsset: targetAsset.asset,
            totalReceived: batch.totalValue * 0.95, // Mock 5% slippage
            assetsProcessed: batch.assets.length,
            originalValue: batch.totalValue
          })
        } else if (hasStarknetAssets && starknetContract) {
          // Use Starknet contract for Starknet assets
          console.log(`Processing Starknet batch ${batch.batchId}`)
          
          // Mock contract call for demonstration
          await new Promise(resolve => setTimeout(resolve, 1500))
          
          results.push({
            batchId: batch.batchId,
            success: true,
            targetAsset: targetAsset.asset,
            totalReceived: batch.totalValue * 0.95, // Mock 5% slippage
            assetsProcessed: batch.assets.length,
            originalValue: batch.totalValue
          })
        } else {
          throw new Error(`No suitable contract available for batch ${batch.batchId}`)
        }

      } catch (err) {
        const error = err as Error
        console.error(`Batch ${batch.batchId} processing error:`, error)
        results.push({
          batchId: batch.batchId,
          success: false,
          error: error.message,
          assetsProcessed: batch.assets.length,
          originalValue: batch.totalValue
        })
      }
    }

    setProcessedResults(results)
    return results
  }, [starknetContract, stellarContract, userAddress])

  // Step 4: Transfer aggregated assets
  const transferToTarget = useCallback(async (results: BatchResult[]): Promise<TransferResult[]> => {
    const successfulBatches = results.filter(r => r.success)
    
    if (successfulBatches.length === 0) {
      throw new Error('No successful batches to transfer')
    }

    // Mock transfer process
    await new Promise(resolve => setTimeout(resolve, 1500))

    const transferResults: TransferResult[] = successfulBatches.map(batch => ({
      asset: batch.targetAsset || 'Unknown',
      amount: batch.totalReceived || 0,
      success: true,
      txHash: `0x${Math.random().toString(16).substr(2, 64)}`
    }))

    return transferResults
  }, [])

  // Main processing orchestrator
  const startProcessing = useCallback(async (): Promise<ProcessingResults> => {
    if (isProcessing) throw new Error('Processing already in progress')

    setIsProcessing(true)
    setError(null)
    setCurrentStep(ProcessingStep.COLLECTING_DUST)

    try {
      // Step 1: Collect dust
      const validBalances = await collectDust()
      await new Promise(resolve => setTimeout(resolve, 1000))

      // Step 2: Optimize batch
      setCurrentStep(ProcessingStep.OPTIMIZING_BATCH)
      const batchGroups = await optimizeBatch(validBalances)
      await new Promise(resolve => setTimeout(resolve, 1500))

      // Step 3: Process batch transactions
      setCurrentStep(ProcessingStep.PROCESSING_BATCH)
      const batchResults = await processBatch(batchGroups)
      await new Promise(resolve => setTimeout(resolve, 2000))

      // Step 4: Transfer
      setCurrentStep(ProcessingStep.TRANSFERRING)
      const transferResults = await transferToTarget(batchResults)
      await new Promise(resolve => setTimeout(resolve, 1500))

      // Step 5: Complete
      setCurrentStep(ProcessingStep.COMPLETE)
      
      return {
        batchResults,
        transferResults,
        totalBatches: batchGroups.length,
        successfulBatches: batchResults.filter(r => r.success).length
      }

    } catch (err) {
      const error = err as Error
      setError(error.message)
      console.error('Processing error:', error)
      throw error
    } finally {
      setIsProcessing(false)
    }
  }, [isProcessing, collectDust, optimizeBatch, processBatch, transferToTarget])

  const resetProcess = useCallback(() => {
    setCurrentStep(ProcessingStep.IDLE)
    setError(null)
    setBatchTransactions([])
    setProcessedResults([])
  }, [])

  return {
    currentStep,
    isProcessing,
    error,
    batchTransactions,
    processedResults,
    startProcessing,
    resetProcess,
    // Expose individual steps for manual control if needed
    collectDust,
    optimizeBatch,
    processBatch,
    transferToTarget
  }
}

const CardSection: React.FC<{
  token: string
  tokenShort: string
  price: number
  isSelected: boolean
  onSelectionChange: (selected: boolean) => void
}> = ({ token, tokenShort, price, isSelected, onSelectionChange }) => (
  <Card className="p-2">
    <CardHeader>
      <CardTitle>
        {price} {tokenShort}
      </CardTitle>
      <CardAction className="flex items-center gap-2 mt-2">
        ${price}{' '}
        <Checkbox
          className="!bg-accent"
          checked={isSelected}
          onCheckedChange={(checked) => onSelectionChange(checked === true)}
        />
      </CardAction>
      <CardDescription>{token}</CardDescription>
    </CardHeader>
  </Card>
)

export default function WalletBalances() {
  const [starknetBalances, setStarknetBalances] = useState<Balances>({})
  const [stellarBalances, setStellarBalances] = useState<StellarBalance[]>([])
  const [starknetAddress, setStarknetAddress] = useState<string | null>(null)
  const [stellarAddress, setStellarAddress] = useState<string | null>(null)
  const [selectedTokens, setSelectedTokens] = useState<Set<string>>(new Set())
  const [stellarAccountError, setStellarAccountError] = useState<'not_found' | 'rate_limit' | 'maintenance' | null>(null)
  const [stellarGeneralError, setStellarGeneralError] = useState<string | null>(null)
  const [isLoadingFriendbot, setIsLoadingFriendbot] = useState(false)

  const fetchStarknetBalances = async () => {
    try {
      const provider = new RpcProvider({
        nodeUrl: 'https://starknet-sepolia.public.blastapi.io',
      })
      const { wallet } = await connectStarknet({
        webWalletUrl: 'https://web.hydrogen.argent47.net',
        dappName: 'Dust Aggregator',
        modalMode: 'canAsk',
      })

      const w = wallet as WalletLike
      const address =
        w.selectedAddress || w.selectedAccount?.address || w.account?.address

      setStarknetAddress(address ?? null)
      if (!address) return

      const balancesObj: Balances = {}
      for (const [, token] of Object.entries(TOKENS)) {
        const contract = new Contract(ERC20_ABI, token.address, provider)
        const result = await contract.balanceOf(address)
        const balance = uint256.uint256ToBN(result.balance)
        balancesObj[token.symbol] =
          Number(balance.toString()) / 10 ** token.decimals
      }
      setStarknetBalances(balancesObj)
    } catch (error) {
      console.error('Error connecting to Starknet:', error)
    }
  }

  const fetchStellarBalancesForAddress = async (address: string) => {
    try {
      setStellarAccountError(null)
      const res = await fetch(
        `https://horizon-testnet.stellar.org/accounts/${address}`
      )
      if (!res.ok) {
        if (res.status === 404) {
          setStellarAccountError('not_found')
          setStellarBalances([])
          return
        }
        if (res.status === 429) {
          setStellarAccountError('rate_limit')
          return
        }
        if (res.status === 503 || res.status === 504) {
          setStellarAccountError('maintenance')
          return
        }
        throw new Error(`HTTP ${res.status}: ${res.statusText}`)
      }
      const data = await res.json()
      setStellarBalances(data.balances || [])
    } catch (err) {
      console.error('Error fetching Stellar balances:', err)
      throw err
    }
  }

  const fetchStellarBalances = async () => {
    try {
      const kit = initStellarKit()
      return new Promise<void>((resolve, reject) => {
        kit.openModal({
          onWalletSelected: async (wallet) => {
            try {
              kit.setWallet(wallet.id)
              const { address } = await kit.getAddress()
              setStellarAddress(address)
              await fetchStellarBalancesForAddress(address)
              resolve()
            } catch (err) {
              console.error('Error in onWalletSelected:', err)
              reject(err)
            }
          },
          onClosed: () => {
            console.log('Stellar wallet modal closed')
            reject(new Error('Wallet selection cancelled'))
          },
        })
      })
    } catch (error) {
      console.error('Error initializing Stellar wallet:', error)
      throw error
    }
  }

  const fundWithFriendbot = async () => {
    if (!stellarAddress) return
    setIsLoadingFriendbot(true)
    try {
      setStellarGeneralError(null)
      const res = await fetch(`https://friendbot.stellar.org?addr=${stellarAddress}`)
      if (!res.ok) {
        throw new Error('Friendbot funding failed')
      }
      // Wait a bit for Horizon to catch up
      await new Promise((resolve) => setTimeout(resolve, 2000))
      await fetchStellarBalancesForAddress(stellarAddress)
    } catch (err) {
      console.error('Friendbot error:', err)
      setStellarGeneralError('Friendbot funding failed. Please try again later.')
    } finally {
      setIsLoadingFriendbot(false)
    }
  }

  const handleTokenSelection = (tokenId: string, selected: boolean) => {
    setSelectedTokens((prev) => {
      const newSet = new Set(prev)
      if (selected) {
        newSet.add(tokenId)
      } else {
        newSet.delete(tokenId)
      }
      return newSet
    })
  }

  const calculateTotalSelectedValue = (): number => {
    let total = 0

    // Calculate Starknet token values
    Object.entries(starknetBalances).forEach(([symbol, amount]) => {
      const tokenId = `starknet-${symbol}`
      if (selectedTokens.has(tokenId)) {
        // For now, using the amount as the dollar value
        // In a real app, you'd multiply by actual token price
        total += amount
      }
    })

    // Calculate Stellar token values
    stellarBalances.forEach((bal, idx) => {
      const tokenId = `stellar-${idx}`
      if (selectedTokens.has(tokenId)) {
        // For now, using the balance as the dollar value
        // In a real app, you'd multiply by actual token price
        total += parseFloat(bal.balance)
      }
    })

    return total
  }

  // Convert selected tokens to DustBalance format for processing
  const getSelectedDustBalances = (): DustBalance[] => {
    const dustBalances: DustBalance[] = []

    // Add selected Starknet tokens
    Object.entries(starknetBalances).forEach(([symbol, amount]) => {
      const tokenId = `starknet-${symbol}`
      if (selectedTokens.has(tokenId)) {
        dustBalances.push({
          id: tokenId,
          asset: TOKENS[symbol]?.address || symbol,
          symbol,
          amount,
          usdValue: amount, // Mock USD value - replace with real price data
          network: 'starknet'
        })
      }
    })

    // Add selected Stellar tokens
    stellarBalances.forEach((bal, idx) => {
      const tokenId = `stellar-${idx}`
      if (selectedTokens.has(tokenId)) {
        const symbol = bal.asset_type === 'native' ? 'XLM' : bal.asset_code || 'Unknown'
        dustBalances.push({
          id: tokenId,
          asset: bal.asset_code || 'XLM',
          symbol,
          amount: parseFloat(bal.balance),
          usdValue: parseFloat(bal.balance), // Mock USD value - replace with real price data
          network: 'stellar'
        })
      }
    })

    return dustBalances
  }

  const selectedDustBalances = getSelectedDustBalances()
  const userAddress = starknetAddress || stellarAddress
  
  // Create contract instances
  const starknetContract: StarknetContract | null = null // You can initialize this when needed
  const stellarContract: StellarContract | null = stellarAddress ? createStellarContract(DUST_AGGREGATOR_CONTRACT) : null
  
  // Initialize dust aggregator with both contract types
  const {
    currentStep,
    isProcessing,
    error,
    batchTransactions,
    processedResults,
    startProcessing,
    resetProcess
  } = useDustAggregator(starknetContract, stellarContract, userAddress, selectedDustBalances)

  const handleStartProcessing = async () => {
    try {
      const results = await startProcessing()
      console.log('Processing completed:', results)
    } catch (err) {
      console.error('Processing failed:', err)
    }
  }

  const progress = currentStep === ProcessingStep.IDLE ? 0 : (currentStep / 5) * 100

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap max-w-full gap-4">
        <Button
          className=" w-auto bg-card text-foreground"
          onClick={fetchStarknetBalances}
        >
          Connect Starknet Wallet
        </Button>
        <Button className=" w-auto bg-card text-foreground" onClick={fetchStellarBalances}>
          Connect Stellar Wallet
        </Button>
      </div>

      {starknetAddress || stellarAddress ? (
        <ScrollArea className="h-[400px] rounded-md border w-full p-4">
          {starknetAddress && (
            <>
              <h2 className="text-xl font-bold">Starknet Balances</h2>
              {Object.entries(starknetBalances).map(([symbol, amount]) => {
                const tokenId = `starknet-${symbol}`
                return (
                  <CardSection
                    key={symbol}
                    token={symbol}
                    tokenShort={symbol}
                    price={Number(amount.toFixed(4))}
                    isSelected={selectedTokens.has(tokenId)}
                    onSelectionChange={(selected) =>
                      handleTokenSelection(tokenId, selected)
                    }
                  />
                )
              })}
              <Separator className="my-4" />
            </>
          )}

          {stellarAddress && (
            <>
              <h2 className="text-xl font-bold">Stellar Balances</h2>
              
              {stellarAccountError === 'not_found' && (
                <div className="my-4 p-4 border border-yellow-500/50 bg-yellow-500/10 rounded-lg">
                  <div className="flex items-center gap-2 text-yellow-500 mb-2">
                    <AlertCircle className="w-5 h-5" />
                    <span className="font-semibold">Account Not Found</span>
                  </div>
                  <p className="text-sm text-gray-300 mb-4">
                    This account doesn't exist on Stellar testnet yet. It needs to be funded with XLM to be active.
                  </p>
                  {process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'testnet' && (
                    <Button 
                      onClick={fundWithFriendbot} 
                      disabled={isLoadingFriendbot}
                      className="w-full bg-yellow-600 hover:bg-yellow-700 text-white"
                    >
                      {isLoadingFriendbot ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Funding Account...
                        </>
                      ) : (
                        'Fund with Friendbot'
                      )}
                    </Button>
                  )}
                </div>
              )}

              {stellarAccountError === 'rate_limit' && (
                <div className="my-4 p-4 border border-red-500/50 bg-red-500/10 rounded-lg text-red-500">
                  <div className="flex items-center gap-2 mb-1">
                    <AlertCircle className="w-5 h-5" />
                    <span className="font-semibold">Rate Limit Exceeded</span>
                  </div>
                  <p className="text-sm">Too many requests. Please try again later.</p>
                </div>
              )}

              {stellarAccountError === 'maintenance' && (
                <div className="my-4 p-4 border border-blue-500/50 bg-blue-500/10 rounded-lg text-blue-500">
                  <div className="flex items-center gap-2 mb-1">
                    <AlertCircle className="w-5 h-5" />
                    <span className="font-semibold">Network Maintenance</span>
                  </div>
                  <p className="text-sm">Stellar network is currently under maintenance. Please try again later.</p>
                </div>
              )}

              {stellarGeneralError && (
                <div className="my-4 p-4 border border-red-500/50 bg-red-500/10 rounded-lg text-red-500">
                  <p className="text-sm">{stellarGeneralError}</p>
                </div>
              )}

              {stellarBalances.length > 0 ? (
                stellarBalances.map((bal, idx) => {
                  const tokenId = `stellar-${idx}`
                  const symbol = bal.asset_type === 'native' ? 'XLM' : bal.asset_code || 'Unknown'
                  const shortSymbol = bal.asset_type === 'native' ? 'XLM' : bal.asset_code || '??'

                  return (
                    <CardSection
                      key={idx}
                      token={symbol}
                      tokenShort={shortSymbol}
                      price={Number(parseFloat(bal.balance).toFixed(4))}
                      isSelected={selectedTokens.has(tokenId)}
                      onSelectionChange={(selected) =>
                        handleTokenSelection(tokenId, selected)
                      }
                    />
                  )
                })
              ) : (
                !stellarAccountError && <p className="text-gray-500 text-sm italic">No balances found</p>
              )}
            </>
          )}
        </ScrollArea>
      ) : (
        <p className="text-center text-gray-400">
          Connect wallet to see your balances
        </p>
      )}

      <Card className="relative overflow-hidden p-2 mt-2">
        <CardContent className=" flex items-center justify-between ">
          <div>
            <CardDescription>Total Selected Dust Value</CardDescription>
            <CardTitle>${calculateTotalSelectedValue().toFixed(2)}</CardTitle>
          </div>
          <div>
            {/* Processing Status */}
            {selectedDustBalances.length > 0 && (
              <div className="space-y-4">
                <Card className="mb-4">
                  <CardHeader>
                    <CardTitle>Processing Status</CardTitle>
                    <Progress value={progress} className="mt-4" />
                    <div className="flex justify-between items-center mt-2">
                      <span className="text-sm text-gray-600">
                        Step {currentStep} of 5
                      </span>
                      {isProcessing && (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <ol className="list-decimal pl-4 space-y-2">
                      {Object.entries(stepLabels).map(([step, label]) => {
                        const stepNum = parseInt(step);
                        return (
                          <li
                            key={step}
                            className={`flex items-center gap-2 ${currentStep > stepNum
                                ? 'text-green-600'
                                : currentStep === stepNum
                                  ? 'text-blue-600 font-semibold'
                                  : 'text-gray-400'
                              }`}
                          >
                            {currentStep > stepNum && <CheckCircle className="w-4 h-4" />}
                            {currentStep === stepNum && isProcessing && <Loader2 className="w-4 h-4 animate-spin" />}
                            <span>{label}</span>
                          </li>
                        );
                      })}
                    </ol>
                  </CardContent>
                  <CardFooter className="flex flex-col gap-2">
                    {error && (
                      <div className="flex items-center gap-2 text-red-600 text-sm">
                        <AlertCircle className="w-4 h-4" />
                        <span>{error}</span>
                      </div>
                    )}

                    <div className="flex gap-2 w-full">
                      <Button
                        className="relative overflow-hidden flex-1 !bg-accent"
                        size="lg"
                        variant="outline"
                        onClick={handleStartProcessing}
                        disabled={
                          isProcessing ||
                          !userAddress ||
                          currentStep === ProcessingStep.COMPLETE ||
                          selectedDustBalances.length === 0
                        }
                      >
                        {isProcessing ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin mr-2" />
                            Processing...
                          </>
                        ) : currentStep === ProcessingStep.COMPLETE ? (
                          <>
                            <CheckCircle className="w-4 h-4 mr-2" />
                            Complete
                          </>
                        ) : (
                          `Process ${selectedDustBalances.length} Selected Tokens`
                        )}
                        {!isProcessing &&
                          currentStep !== ProcessingStep.COMPLETE &&
                          selectedDustBalances.length > 0 && (
                            <BorderBeam
                              size={40}
                              initialOffset={20}
                              className="from-transparent via-yellow-500 to-transparent"
                            />
                          )}
                      </Button>

                     
                      {currentStep === ProcessingStep.COMPLETE && (
                        <Button
                          onClick={resetProcess}
                          variant="outline"
                          size="lg"
                        >
                          Reset
                        </Button>
                      )}
                    </div>
                  </CardFooter>
                </Card>

                {/* Batch Preview */}
                {batchTransactions.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Batch Transactions ({batchTransactions.length})</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {batchTransactions.map((batch) => (
                          <div key={batch.batchId} className="border rounded-lg p-3">
                            <div className="flex justify-between items-center mb-2">
                              <h4 className="font-semibold">Batch {batch.batchId}</h4>
                              <span className="text-sm text-gray-600">
                                ${batch.totalValue.toFixed(2)} • {batch.assets.length} assets
                              </span>
                            </div>
                            <div className="text-xs text-gray-500 space-y-1">
                              {batch.assets.map((asset: DustBalance, idx: number) => (
                                <div key={idx} className="flex justify-between">
                                  <span className="font-mono">{asset.symbol}</span>
                                  <span>${(asset.usdValue || 0).toFixed(2)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Results Summary */}
                {processedResults.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Processing Results</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {processedResults.map((result) => (
                          <div key={result.batchId} className="flex justify-between items-center p-2 border rounded">
                            <span>Batch {result.batchId}</span>
                            <div className="flex items-center gap-2">
                              {result.success ? (
                                <CheckCircle className="w-4 h-4 text-green-500" />
                              ) : (
                                <AlertCircle className="w-4 h-4 text-red-500" />
                              )}
                              <span className="text-sm">
                                {result.success
                                  ? `$${result.originalValue.toFixed(2)} processed`
                                  : result.error}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div> 
  );
};