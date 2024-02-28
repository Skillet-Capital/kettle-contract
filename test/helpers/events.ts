import { ethers } from "hardhat";
import { ContractTransactionReceipt } from "ethers"
import { Kettle__factory } from "../../typechain-types";

import { LienStruct, LienStateStruct } from "../../typechain-types/contracts/Kettle";

export async function getTimestamp(block: number) {
  return ethers.provider.getBlock(block).then((block) => block!.timestamp);
}

type LogName = "Borrow" | "BuyInLien" | "BuyInLienWithLoan" | "BuyWithLoan" | "Claim" | "Initialized" | "Payment" | "Refinance" | "Repay" | "SellInLien" | "SellInLienWithLoan";

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
      lender: lien.lender,
      borrower: lien.borrower,
      recipient: lien.recipient,
      currency: lien.currency,
      collection: lien.collection,
      tokenId: lien.tokenId,
      size: lien.size,
      principal: lien.principal,
      rate: lien.rate,
      period: lien.period,
      tenor: lien.tenor,
      startTime: lien.startTime,
      fee: lien.fee,
      gracePeriod: lien.gracePeriod,
      state: {
        paidThrough: lien.startTime,
        amountOwed: lien.principal
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
    pastInterest: payment.pastInterest,
    pastFee: payment.pastFee,
    currentInterest: payment.currentInterest,
    currentFee: payment.currentFee,
    principal: payment.principal,
    amountOwed: payment.amountOwed,
    paidThrough: payment.paidThrough
  }
}

export function extractRepayLog(receipt: ContractTransactionReceipt) {
  const KettleInterface = Kettle__factory.createInterface();
  const { topicHash } = KettleInterface.getEvent("Repay");

  const log = receipt!.logs.find((log) => log.topics[0] === topicHash);
  const repay = KettleInterface.decodeEventLog("Repay", log!.data, log!.topics);

  return {
    lienId: repay.lienId,
    pastInterest: repay.pastInterest,
    pastFee: repay.pastFee,
    currentInterest: repay.currentInterest,
    currentFee: repay.currentFee,
    principal: repay.principal,
    amountOwed: repay.amountOwed
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
    pastInterest: repay.pastInterest,
    pastFee: repay.pastFee,
    currentInterest: repay.currentInterest,
    currentFee: repay.currentFee,
    principal: repay.principal,
    amountOwed: repay.amountOwed,
    amount: repay.amount
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
    askAmount: log.askAmount,
    amountOwed: log.amountOwed,
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
    bidAmount: log.bidAmount,
    amountOwed: log.amountOwed,
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
    askAmount: log.askAmount,
    borrowAmount: log.borrowAmount,
    amountOwed: log.amountOwed,
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
    bidAmount: log.bidAmount,
    borrowAmount: log.borrowAmount,
    amountOwed: log.amountOwed,
    principal: log.principal,
    pastInterest: log.pastInterest,
    pastFee: log.pastFee,
    currentInterest: log.currentInterest,
    currentFee: log.currentFee
  }
}
