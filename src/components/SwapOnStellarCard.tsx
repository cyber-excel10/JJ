'use client'

import { useState } from 'react'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from './ui/button'
import { BorderBeam } from './magicui/border-beam'
import DonationCard from './DonationCard'

const SelectToken = () => {
  return (
    <Select>
      <SelectTrigger className=" w-full !bg-accent !text-foreground">
        <SelectValue placeholder="Select Token" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="xlm">XLM</SelectItem>
        <SelectItem value="usdc">USDC</SelectItem>
      </SelectContent>
    </Select>
  )
}

const WalletBalance = () => {
  return (
    <Card className=" p-2 mt-4 bg-accent">
      <CardHeader>
        <CardDescription className=" text-foreground">
          You&apos;ll receive approximately
        </CardDescription>
        <CardAction>~11.93</CardAction>
        <CardDescription className=" text-foreground">
          Exchange rate
        </CardDescription>
        <CardAction className=" mt-6 ">$1.00 = 7.5 XLM</CardAction>
      </CardHeader>
    </Card>
  )
}

export default function SwapOnStellarCardSection() {
  const [selectedToken, setSelectedToken] = useState<string>('xlm')
  const [isSwapped, setIsSwapped] = useState(false)
  const [isSwapping, setIsSwapping] = useState(false)

  // Simulated available balance (in production, this would come from wallet state)
  const availableBalance = '$1.59'

  const handleSwap = async () => {
    setIsSwapping(true)
    
    // Simulate swap transaction
    // In production, this would call the actual swap logic
    await new Promise(resolve => setTimeout(resolve, 2000))
    
    setIsSwapping(false)
    setIsSwapped(true)
  }

  const handleDonationComplete = (txHash: string, amount: string) => {
    console.log('Donation completed:', { txHash, amount })
  }

  return (
    <div className="space-y-4">
      <Card className=' mb-4'>
        <CardHeader>
          <CardDescription>Available Balance</CardDescription>
          <CardTitle className=" font-bold text-2xl">{availableBalance}</CardTitle>
          <hr color="white" className=" mt-2 w-full" />
        </CardHeader>
        <CardContent>
          <h1 className=" font-bold text-lg mb-2">Swap To</h1>
          <SelectToken />
          <WalletBalance />
        </CardContent>
        <CardFooter>
          <Button
            onClick={handleSwap}
            disabled={isSwapping}
            className="relative overflow-hidden w-full !bg-accent"
            size="lg"
            variant="outline"
          >
            {isSwapping ? 'Swapping...' : isSwapped ? 'Swap Complete!' : 'Swap Now'}
            {!isSwapping && (
              <BorderBeam
                size={40}
                initialOffset={20}
                className="from-transparent via-yellow-500 to-transparent"
                transition={{
                  type: 'tween',
                  stiffness: 60,
                  damping: 20,
                }}
              />
            )}
          </Button>
        </CardFooter>
      </Card>

      {/* Donation Card - appears after successful swap */}
      {isSwapped && (
        <DonationCard
          amount={availableBalance}
          showDonationCard={true}
          onDonationComplete={handleDonationComplete}
        />
      )}
    </div>
  )
}
