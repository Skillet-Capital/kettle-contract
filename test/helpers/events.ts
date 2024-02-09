import { ethers } from "hardhat";
import { ContractTransactionReceipt } from "ethers"
import { Kettle__factory } from "../../typechain-types";

import { LienStruct, LienStateStruct } from "../../typechain-types/contracts/Helpers";

export async function getTimestamp(block: number) {
  return ethers.provider.getBlock(block).then((block) => block!.timestamp);
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
      currency: lien.currency,
      collection: lien.collection,
      tokenId: lien.tokenId,
      size: lien.size,
      principal: lien.principal,
      rate: lien.rate,
      period: lien.period,
      tenor: lien.tenor,
      startTime: lien.startTime,
      defaultPeriod: lien.defaultPeriod,
      defaultRate: lien.defaultRate,
      state: {
        lastPayment: lien.startTime,
        amountOwed: lien.principal
      }
    }
  }
}

export async function extractPaymentLog(receipt: ContractTransactionReceipt) {
  const KettleInterface = Kettle__factory.createInterface();
  const { topicHash } = KettleInterface.getEvent("Payment");

  const log = receipt!.logs.find((log) => log.topics[0] === topicHash);
  const payment = KettleInterface.decodeEventLog("Payment", log!.data, log!.topics);

  return {
    lienId: payment.lienId,
    amount: payment.amount,
    amountOwed: payment.amountOwed,
    timestamp: await getTimestamp(receipt!.blockNumber)
  }
}

export function extractRepayLog(receipt: ContractTransactionReceipt) {
  const KettleInterface = Kettle__factory.createInterface();
  const { topicHash } = KettleInterface.getEvent("Repay");

  const log = receipt!.logs.find((log) => log.topics[0] === topicHash);
  const repay = KettleInterface.decodeEventLog("Repay", log!.data, log!.topics);

  return {
    lienId: repay.lienId,
    amountOwed: repay.amountOwed,
  }
}
