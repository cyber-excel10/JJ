'use client'

import React, { useState } from 'react';
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
import { useWallet } from '@creit.tech/stellar-wallets-kit'; // Assuming stellar-wallets-kit provides a useWallet hook
import { prepareWithdrawTransaction } from '@/lib/stellar/contract';
import { toast } from 'sonner'; // For notifications, assuming you have sonner installed
import { Input } from './ui/input'; // Assuming you have an Input component
import { Link } from 'lucide-react'; // For the external link icon

// --- Helper for truncating Stellar addresses ---
const truncateAddress = (address: string) => {
  if (!address) return '';
  return `${address.substring(0, 4)}...${address.substring(address.length - 4)}`;
};
// --- Placeholder Token Data ---
const tokens = [
  { value: 'xlm', label: 'XLM', address: 'CDLZFC3FMZN8CSVTK1J8C3NE4S', icon: '💰' }, // Replace with actual XLM contract ID if it's wrapped
  { value: 'usdc', label: 'USDC', address: 'CCJZ3W3KJF36S', icon: '💵' }, // Replace with actual USDC contract ID
];

const SelectToken = ({ selectedToken, onSelectToken }) => {
  return (
    <Select value={selectedToken} onValueChange={onSelectToken}>
      <SelectTrigger className=" w-full !bg-accent !text-foreground">
        <SelectValue placeholder="Select Token" />
      </SelectTrigger>
      <SelectContent>
        {tokens.map((token) => (
          <SelectItem key={token.value} value={token.value}>
            {token.icon} {token.label}
          </SelectItem>
        ))}
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
  const { wallet, stellarWalletKit } = useWallet(); // Get wallet and stellarWalletKit from context
  const [selectedTokenValue, setSelectedTokenValue] = useState<string>('');
  const [withdrawalAmount, setWithdrawalAmount] = useState<string>('');
  const [isWithdrawing, setIsWithdrawing] = useState<boolean>(false);
  const [withdrawalTxHash, setWithdrawalTxHash] = useState<string | null>(null);

  const connectedWalletAddress = wallet?.publicKey || '';
  const selectedToken = tokens.find(t => t.value === selectedTokenValue);

  const handleWithdraw = async () => {
    if (!wallet || !stellarWalletKit || !selectedToken || !withdrawalAmount || parseFloat(withdrawalAmount) <= 0) {
      toast.error("Please connect your wallet, select a token, and enter a valid amount.");
      return;
    }

    setIsWithdrawing(true);
    setWithdrawalTxHash(null);

    try {
      // Convert amount to the correct format for Soroban (e.g., bigint with appropriate decimals)
      // This is a crucial step and depends on your token's decimals.
      // For simplicity, let's assume 7 decimal places for now. Adjust as needed.
      const amountBigInt = BigInt(Math.floor(parseFloat(withdrawalAmount) * 10 ** 7));

      const transaction = await prepareWithdrawTransaction(
        connectedWalletAddress,
        {
          tokenAddress: selectedToken.address,
          amount: amountBigInt,
          toAddress: connectedWalletAddress, // Destination is always the connected wallet
        },
        stellarWalletKit
      );

      // Sign the transaction
      const signedTransaction = await stellarWalletKit.signTransaction(transaction, {
        publicKey: connectedWalletAddress,
      });

      // Submit the transaction
      const result = await stellarWalletKit.submitTransaction(signedTransaction);

      if (result.successful) {
        toast.success("Withdrawal successful!");
        setWithdrawalTxHash(result.hash);
        // Optionally, clear amount or update balance
        setWithdrawalAmount('');
      } else {
        throw new Error(result.error || "Transaction failed.");
      }

    } catch (error: any) {
      console.error("Withdrawal failed:", error);
      toast.error(`Withdrawal failed: ${error.message || "Unknown error."}`);
    } finally {
      setIsWithdrawing(false);
    }
  };

  return (
    <Card className=' mb-4'>
      <CardHeader>
        <CardDescription>Available Balance</CardDescription>
        <CardTitle className=" font-bold text-2xl">$ 1.59</CardTitle>
        <hr color="white" className=" mt-2 w-full" />
      </CardHeader>
      <CardContent>
        <h1 className=" font-bold text-lg mb-2">Swap To</h1>
        <SelectToken selectedToken={selectedTokenValue} onSelectToken={setSelectedTokenValue} />
        <WalletBalance />

        {/* Withdrawal Section */}
        {connectedWalletAddress && (
          <div className="mt-6 p-4 border rounded-lg bg-secondary">
            <h2 className="font-bold text-lg mb-2">Withdraw Funds</h2>
            <CardDescription className="text-foreground mb-4">
              Withdrawing to: <span className="font-mono">{truncateAddress(connectedWalletAddress)}</span> (your connected wallet)
            </CardDescription>
            <div className="flex items-center space-x-2 mb-4">
              <Input
                type="number"
                placeholder="Amount to withdraw"
                value={withdrawalAmount}
                onChange={(e) => setWithdrawalAmount(e.target.value)}
                className="w-full !bg-card"
                disabled={isWithdrawing}
              />
              {selectedToken && (
                <span className="whitespace-nowrap font-medium text-primary">
                  {selectedToken.label}
                </span>
              )}
            </div>

            <Button
              className="relative overflow-hidden w-full !bg-green-500 hover:!bg-green-600 text-white"
              size="lg"
              onClick={handleWithdraw}
              disabled={!connectedWalletAddress || !selectedToken || !withdrawalAmount || isWithdrawing}
            >
              {isWithdrawing ? "Withdrawing..." : "Withdraw"}
              <BorderBeam
                size={40}
                initialOffset={20}
                className="from-transparent via-green-300 to-transparent"
                transition={{
                  type: 'tween',
                  stiffness: 60,
                  damping: 20,
                }}
              />
            </Button>

            {withdrawalTxHash && (
              <div className="mt-4 text-center">
                <p className="text-sm text-muted-foreground">Withdrawal Transaction:</p>
                <a
                  href={`https://stellar.expert/soroban/tx/${withdrawalTxHash}`} // Adjust network if not public
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center text-primary hover:underline break-all"
                >
                  {truncateAddress(withdrawalTxHash)} <Link className="ml-1 h-4 w-4" />
                </a>
              </div>
            )}
          </div>
        )}
      </CardContent>
      <CardFooter>
        <Button
          className="relative overflow-hidden w-full !bg-accent"
          size="lg"
          variant="outline"
        >
          Swap Now
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
        </Button>
      </CardFooter>
    </Card>
  )
}