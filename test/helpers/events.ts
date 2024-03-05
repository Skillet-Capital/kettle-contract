import { ethers } from "hardhat";
import { ContractTransactionReceipt } from "ethers"
import { Kettle__factory } from "../../typechain-types";

import { LienStruct, LienStateStruct } from "../../typechain-types/contracts/Kettle";

export async function getTimestamp(block: number) {
  return ethers.provider.getBlock(block).then((block) => block!.timestamp);
}

type LogName = "Borrow" | "BuyInLien" | "BuyInLienWithLoan" | "BuyWithLoan" | "Claim" | "Payment" | "Refinance" | "Repay" | "SellInLien" | "SellInLienWithLoan" | "SellWithLoan" | "MarketOrder";

function extractLog(receipt: ContractTransactionReceipt, logName: LogName) {
  const KettleInterface = Kettle__factory.createInterface();
  const { topicHash } = KettleInterface.getEvent(logName);

  const log = receipt!.logs.find((log) => log.topics[0] === topicHash);
  return KettleInterface.decodeEventLog(logName, log!.data, log!.topics);
}

interface BorrowLog {
  lien: LienStruct;
  lienId: string | number | bigint;
}
export function extractBorrowLog(receipt: ContractTransactionReceipt): BorrowLog {
  const KettleInterface = Kettle__factory.createInterface();
  const { topicHash } = KettleInterface.getEvent("Borrow");

  const log = receipt!.logs.find((log) => log.topics[0] === topicHash);
  const lien = KettleInterface.decodeEventLog("Borrow", log!.data, log!.topics);

  return {
    lienId: lien.lienId,
    lien: {
      borrower: lien.borrower,
      recipient: lien.recipient,
      currency: lien.currency,
      collection: lien.collection,
      tokenId: lien.tokenId,
      size: lien.size,
      principal: lien.principal,
      rate: lien.rate,
      defaultRate: lien.defaultRate,
      fee: lien.fee,
      period: lien.period,
      gracePeriod: lien.gracePeriod,
      installments: lien.installments,
      startTime: lien.startTime,
      state: {
        installment: 0,
        principal: lien.principal
      }
    }
  }
}

export function extractPaymentLog(receipt: ContractTransactionReceipt) {
  const KettleInterface = Kettle__factory.createInterface();
  const { topicHash } = KettleInterface.getEvent("Payment");

  const log = receipt!.logs.find((log) => log.topics[0] === topicHash);
  const payment = KettleInterface.decodeEventLog("Payment", log!.data, log!.topics);

  return {
    lienId: payment.lienId,
    installment: payment.installment,
    principal: payment.principal,
    pastInterest: payment.pastInterest,
    pastFee: payment.pastFee,
    currentInterest: payment.currentInterest,
    currentFee: payment.currentFee,
    newPrincipal: payment.newPrincipal,
    newInstallment: payment.newInstallment
  }
}

export function extractRepayLog(receipt: ContractTransactionReceipt) {
  const KettleInterface = Kettle__factory.createInterface();
  const { topicHash } = KettleInterface.getEvent("Repay");

  const log = receipt!.logs.find((log) => log.topics[0] === topicHash);
  const repay = KettleInterface.decodeEventLog("Repay", log!.data, log!.topics);

  return {
    lienId: repay.lienId,
    installment: repay.installment,
    balance: repay.balance,
    principal: repay.principal,
    pastInterest: repay.pastInterest,
    pastFee: repay.pastFee,
    currentInterest: repay.currentInterest,
    currentFee: repay.currentFee
  }
}

export function extractRefinanceLog(receipt: ContractTransactionReceipt) {
  const KettleInterface = Kettle__factory.createInterface();
  const { topicHash } = KettleInterface.getEvent("Refinance");

  const log = receipt!.logs.find((log) => log.topics[0] === topicHash);
  const repay = KettleInterface.decodeEventLog("Refinance", log!.data, log!.topics);

  return {
    oldLienId: repay.oldLienId,
    newLienId: repay.newLienId,
    amount: repay.amount,
    balance: repay.balance,
    principal: repay.principal,
    pastInterest: repay.pastInterest,
    pastFee: repay.pastFee,
    currentInterest: repay.currentInterest,
    currentFee: repay.currentFee
  }
}

export function extractBuyWithLoanLog(receipt: ContractTransactionReceipt) {
  const log = extractLog(receipt, "BuyWithLoan");

  return {
    lienId: log.lienId,
    buyer: log.buyer,
    seller: log.seller,
    currency: log.currency,
    collection: log.collection,
    tokenId: log.tokenId,
    size: log.size,
    amount: log.amount,
    netAmount: log.netAmount,
    borrowAmount: log.borrowAmount
  }
}

export function extractSellWithLoanLog(receipt: ContractTransactionReceipt) {
  const log = extractLog(receipt, "SellWithLoan");

  return {
    lienId: log.lienId,
    buyer: log.buyer,
    seller: log.seller,
    currency: log.currency,
    collection: log.collection,
    tokenId: log.tokenId,
    size: log.size,
    amount: log.amount,
    netAmount: log.netAmount,
    borrowAmount: log.borrowAmount
  }
}

export function extractBuyInLienLog(receipt: ContractTransactionReceipt) {
  const log = extractLog(receipt, "BuyInLien");

  return {
    lienId: log.lienId,
    buyer: log.buyer,
    seller: log.seller,
    currency: log.currency,
    collection: log.collection,
    tokenId: log.tokenId,
    size: log.size,
    amount: log.amount,
    netAmount: log.netAmount,
    balance: log.balance,
    principal: log.principal,
    pastInterest: log.pastInterest,
    pastFee: log.pastFee,
    currentInterest: log.currentInterest,
    currentFee: log.currentFee
  }
}

export function extractSellInLienLog(receipt: ContractTransactionReceipt) {
  const log = extractLog(receipt, "SellInLien");

  return {
    lienId: log.lienId,
    buyer: log.buyer,
    seller: log.seller,
    currency: log.currency,
    collection: log.collection,
    tokenId: log.tokenId,
    size: log.size,
    amount: log.amount,
    netAmount: log.netAmount,
    balance: log.balance,
    principal: log.principal,
    pastInterest: log.pastInterest,
    pastFee: log.pastFee,
    currentInterest: log.currentInterest,
    currentFee: log.currentFee
  }
}

export function extractBuyInLienWithLoanLog(receipt: ContractTransactionReceipt) {
  const log = extractLog(receipt, "BuyInLienWithLoan");

  return {
    oldLienId: log.oldLienId,
    newLienId: log.newLienId,
    buyer: log.buyer,
    seller: log.seller,
    currency: log.currency,
    collection: log.collection,
    tokenId: log.tokenId,
    size: log.size,
    amount: log.amount,
    netAmount: log.netAmount,
    borrowAmount: log.borrowAmount,
    balance: log.balance,
    principal: log.principal,
    pastInterest: log.pastInterest,
    pastFee: log.pastFee,
    currentInterest: log.currentInterest,
    currentFee: log.currentFee
  }
}

export function extractSellInLienWithLoanLog(receipt: ContractTransactionReceipt) {
  const log = extractLog(receipt, "SellInLienWithLoan");

  return {
    oldLienId: log.oldLienId,
    newLienId: log.newLienId,
    buyer: log.buyer,
    seller: log.seller,
    currency: log.currency,
    collection: log.collection,
    tokenId: log.tokenId,
    size: log.size,
    amount: log.amount,
    netAmount: log.netAmount,
    borrowAmount: log.borrowAmount,
    balance: log.balance,
    principal: log.principal,
    pastInterest: log.pastInterest,
    pastFee: log.pastFee,
    currentInterest: log.currentInterest,
    currentFee: log.currentFee
  }
}

export function extractMarketOrderLog(receipt: ContractTransactionReceipt) {
  const log = extractLog(receipt, "MarketOrder");

  return {
    buyer: log.buyer,
    seller: log.seller,
    currency: log.currency,
    collection: log.collection,
    tokenId: log.tokenId,
    size: log.size,
    amount: log.amount,
    netAmount: log.netAmount
  }
}
