import { time } from "@nomicfoundation/hardhat-toolbox/network-helpers";

import { expect } from "chai";
import { Signer, parseUnits } from "ethers";

import { getFixture } from './setup';

import {
  TestERC20,
  TestERC721,
  Kettle
} from "../typechain-types";
import { LienStruct, PaymentDeadlineStruct } from "../typechain-types/contracts/Kettle";

const DAY_SECONDS = 86400;
const MONTH_SECONDS = BigInt(DAY_SECONDS * 365 / 12);
const YEAR_SECONDS = BigInt(DAY_SECONDS * 365);
const HALF_MONTH_SECONDS = MONTH_SECONDS / 2n;

function parsePaymentDeadline(deadline: PaymentDeadlineStruct) {
  return {
    periodStart: deadline.periodStart,
    deadline: deadline.deadline,
    principal: deadline.principal,
    interest: deadline.interest,
    fee: deadline.fee
  }
}

describe.skip("LienStatus", function () {
  let kettle: Kettle;
  let signers: Signer[];
  let testErc20: TestERC20;
  let testErc721: TestERC721;

  beforeEach(async () => {
    const fixture = await getFixture();
    kettle = fixture.kettle;
    signers = fixture.signers;
    testErc20 = fixture.testErc20;
    testErc721 = fixture.testErc721;
  });

  let lien: LienStruct;
  
  let lender: Signer;
  let borrower: Signer;
  let recipient: Signer;
  
  let principal: bigint;
  let rate: bigint;
  let defaultRate: bigint;
  let fee: bigint;

  let period: bigint;
  let gracePeriod: bigint;
  let installments: bigint | number;

  let startTime: bigint;

  let interestAmount: bigint;
  let defaultInterestAmount: bigint;
  let feeAmount: bigint;

  let lastInstallmentTime: bigint;
  let endTime: bigint;

  const paramSets = [
    { description: "single installment, 1 month period, 1 month grace period", params: { period: MONTH_SECONDS, gracePeriod: MONTH_SECONDS, installments: 1 } },
    { description: "single installment, 1 year period, 1 month grace period", params: { period: YEAR_SECONDS, gracePeriod: MONTH_SECONDS, installments: 1 } },
    { description: "12 installments, 1 year period, 1 month grace period", params: { period: YEAR_SECONDS, gracePeriod: MONTH_SECONDS, installments: 12 } },
    { description: "12 installments, 1 month period, 1 month grace period", params: { period: MONTH_SECONDS, gracePeriod: MONTH_SECONDS, installments: 12 } },
    { description: "12 installments, 1 month period, 1/2 month grace period", params: { period: MONTH_SECONDS, gracePeriod: HALF_MONTH_SECONDS, installments: 12 } }
  ];

  for (const params of paramSets) {
    describe(params.description, () => {
      beforeEach(async () => {
        [lender, borrower, recipient] = signers;
    
        principal = parseUnits("1000", 6);
        rate = 1000n;
        defaultRate = 2000n;
        fee = 50n;
    
        ({ period, gracePeriod, installments } = params.params);
    
        startTime = await time.latest().then((t) => BigInt(t));
    
        lien = {
          borrower,
          recipient,
          currency: testErc20,
          collection: testErc721,
          itemType: 0,
          tokenId: 1,
          size: 1,
          principal,
          rate,
          defaultRate,
          fee,
          period,
          gracePeriod,
          installments,
          startTime,
          state: {
            installment: 0,
            principal
          }
        }
    
        lastInstallmentTime = startTime + (BigInt(lien.period) * (BigInt(lien.installments) - 1n));
        endTime = startTime + (BigInt(lien.period) * BigInt(lien.installments));
    
        const denominator = (MONTH_SECONDS * 12n) / BigInt(lien.period);
    
        interestAmount = ((BigInt(lien.rate) * BigInt(lien.principal)) / 10_000n) / denominator;
        defaultInterestAmount = ((BigInt(lien.defaultRate) * BigInt(lien.principal)) / 10_000n) / denominator;
        feeAmount = (BigInt(lien.fee) * BigInt(lien.principal)) / 10_000n / denominator;
      });

      it.only("early [time < paid through]", async () => {
        lien = { ...lien, state: { ...lien.state, installment: 1 } }

        const { status, balance, delinquent, current } = await kettle.lienStatus(lien)
          .then(({ status, balance, delinquent, current }) => ({
            status,
            balance,
            delinquent: parsePaymentDeadline(delinquent),
            current: parsePaymentDeadline(current)
        }));

        const payments = await kettle.payments(lien);
        const repayment = await kettle.repayment(lien);

        expect(status).to.equal(0);
        expect(balance)
          .to.equal(payments.balance)
          .to.equal(BigInt(lien.principal) + interestAmount + feeAmount);

        expect(delinquent.periodStart).to.equal(0);
        expect(delinquent.deadline).to.equal(0);
        expect(delinquent.principal).to.equal(0);
        expect(delinquent.interest).to.equal(0).to.equal(payments.pastInterest).to.equal(repayment.pastInterest);
        expect(delinquent.fee).to.equal(0).to.equal(payments.pastFee).to.equal(repayment.pastFee);

        expect(current.periodStart).to.equal(startTime + period);
        expect(current.deadline).to.equal(startTime + period * 2n);
        expect(current.principal).to.equal(0);
        expect(current.interest).to.equal(interestAmount).to.equal(payments.currentInterest);
        expect(current.fee).to.equal(feeAmount).to.equal(payments.currentFee);

        expect(repayment.balance).to.equal(lien.principal);
        expect(repayment.principal).to.equal(lien.principal);
        expect(repayment.pastInterest).to.equal(0);
        expect(repayment.pastFee).to.equal(0);
        expect(repayment.currentInterest).to.equal(0);
        expect(repayment.currentFee).to.equal(0);
      })
    
      it("current [time < period]", async () => {
        const { status, balance, delinquent, current } = await kettle.lienStatus(lien)
          .then(({ status, balance, delinquent, current }) => ({
            status,
            balance,
            delinquent: parsePaymentDeadline(delinquent),
            current: parsePaymentDeadline(current)
        }));

        const payments = await kettle.payments(lien);
        const repayment = await kettle.repayment(lien);
        expect(payments.principal).to.equal(repayment.principal).to.equal(principal);
    
        expect(status).to.equal(0);
        expect(balance)
          .to.equal(payments.balance)
          .to.equal(repayment.balance)
          .to.equal(BigInt(lien.principal) + interestAmount + feeAmount);
    
        expect(delinquent.periodStart).to.equal(0);
        expect(delinquent.deadline).to.equal(0);
        expect(delinquent.principal).to.equal(0);
        expect(delinquent.interest).to.equal(0).to.equal(payments.pastInterest).to.equal(repayment.pastInterest);
        expect(delinquent.fee).to.equal(0).to.equal(payments.pastFee).to.equal(repayment.pastFee);
    
        expect(current.periodStart).to.equal(startTime);
        expect(current.deadline).to.equal(startTime + period);
        expect(current.principal).to.equal(0);
        expect(current.interest).to.equal(interestAmount).to.equal(payments.currentInterest).to.equal(repayment.currentInterest);
        expect(current.fee).to.equal(feeAmount).to.equal(payments.currentFee).to.equal(repayment.currentFee);
      });
    
      it("delinquent [period < time < period + gracePeriod]", async () => {
        await time.increase(period + 1n);
    
        const { status, balance, delinquent, current } = await kettle.lienStatus(lien)
          .then(({ status, balance, delinquent, current }) => ({
            status,
            balance,
            delinquent: parsePaymentDeadline(delinquent),
            current: parsePaymentDeadline(current)
        }));

        const payments = await kettle.payments(lien);
    
        expect(status).to.equal(1);
        if (installments === 1) {
          expect(balance).to.equal(BigInt(lien.principal) + defaultInterestAmount + feeAmount).to.equal(payments.balance);
    
          expect(delinquent.periodStart).to.equal(startTime);
          expect(delinquent.deadline).to.equal(startTime + period + gracePeriod);
          expect(delinquent.principal).to.equal(lien.principal).to.equal(payments.principal);
          expect(delinquent.interest).to.equal(defaultInterestAmount).to.equal(payments.pastInterest);
          expect(delinquent.fee).to.equal(feeAmount).to.equal(payments.pastFee);
      
          expect(current.periodStart).to.equal(0);
          expect(current.deadline).to.equal(0);
          expect(current.principal).to.equal(0);
          expect(current.interest).to.equal(0);
          expect(current.fee).to.equal(0);
        
        } else {
          expect(balance).to.equal(BigInt(lien.principal) + defaultInterestAmount + interestAmount + feeAmount * 2n).to.equal(payments.balance);
    
          expect(delinquent.periodStart).to.equal(startTime);
          expect(delinquent.deadline).to.equal(startTime + period + gracePeriod);
          expect(delinquent.principal).to.equal(0);
          expect(delinquent.interest).to.equal(defaultInterestAmount).to.equal(payments.pastInterest);
          expect(delinquent.fee).to.equal(feeAmount).to.equal(payments.pastFee);
      
          expect(current.periodStart).to.equal(startTime + period);
          expect(current.deadline).to.equal(startTime + period * 2n);
          expect(current.principal).to.equal(0);
          expect(current.interest).to.equal(interestAmount).to.equal(payments.currentInterest);
          expect(current.fee).to.equal(feeAmount).to.equal(payments.currentFee);
        }
      });
    
      it("defaulted [period + gracePeriod < time]", async () => {
        await time.increase(period + gracePeriod + 1n);
    
        const { status, balance, delinquent, current } = await kettle.lienStatus(lien)
          .then(({ status, balance, delinquent, current }) => ({
            status,
            balance,
            delinquent: parsePaymentDeadline(delinquent),
            current: parsePaymentDeadline(current)
        }));

        const payments = await kettle.payments(lien);
    
        expect(status).to.equal(2);
        if (installments === 1) {
          expect(balance).to.equal(BigInt(lien.principal) + defaultInterestAmount + feeAmount).to.equal(payments.balance);
    
          expect(delinquent.periodStart).to.equal(startTime);
          expect(delinquent.deadline).to.equal(startTime + period + gracePeriod);
          expect(delinquent.principal).to.equal(lien.principal).to.equal(payments.principal);
          expect(delinquent.interest).to.equal(defaultInterestAmount).to.equal(payments.pastInterest);
          expect(delinquent.fee).to.equal(feeAmount).to.equal(payments.pastFee);
      
          expect(current.periodStart).to.equal(0);
          expect(current.deadline).to.equal(0);
          expect(current.principal).to.equal(0);
          expect(current.interest).to.equal(0).to.equal(payments.currentInterest);
          expect(current.fee).to.equal(0).to.equal(payments.currentFee);
        } else {
          expect(balance).to.equal(BigInt(lien.principal) + defaultInterestAmount + interestAmount + feeAmount * 2n).to.equal(payments.balance);
    
          expect(delinquent.periodStart).to.equal(startTime);
          expect(delinquent.deadline).to.equal(startTime + period + gracePeriod);
          expect(delinquent.principal).to.equal(0);
          expect(delinquent.interest).to.equal(defaultInterestAmount).to.equal(payments.pastInterest);
          expect(delinquent.fee).to.equal(feeAmount).to.equal(payments.pastFee);
      
          expect(current.periodStart).to.equal(startTime + period);
          expect(current.deadline).to.equal(startTime + period * 2n);
          expect(current.principal).to.equal(0);
          expect(current.interest).to.equal(interestAmount).to.equal(payments.currentInterest);
          expect(current.fee).to.equal(feeAmount).to.equal(payments.currentFee);
        }
      });
    
      it("current (last installment) [last installment < time < last installment + period]", async () => {
        await time.increaseTo(lastInstallmentTime + 1n);
    
        // missed no installments
        lien.state.installment = BigInt(lien.installments) - 1n;
    
        const { status, balance, delinquent, current } = await kettle.lienStatus(lien)
          .then(({ status, balance, delinquent, current }) => ({
            status,
            balance,
            delinquent: parsePaymentDeadline(delinquent),
            current: parsePaymentDeadline(current)
        }));

        const payments = await kettle.payments(lien);
    
        // expect status to be current
        expect(status).to.equal(0);
        expect(balance).to.equal(BigInt(lien.principal) + interestAmount + feeAmount).to.equal(payments.balance);
    
        expect(delinquent.periodStart).to.equal(0);
        expect(delinquent.deadline).to.equal(0);
        expect(delinquent.principal).to.equal(0);
        expect(delinquent.interest).to.equal(0).to.equal(payments.pastInterest);
        expect(delinquent.fee).to.equal(0).to.equal(payments.pastFee);
    
        expect(current.periodStart).to.equal(lastInstallmentTime);
        expect(current.deadline).to.equal(lastInstallmentTime + period);
        expect(current.principal).to.equal(lien.principal).to.equal(payments.principal);
        expect(current.interest).to.equal(interestAmount).to.equal(payments.currentInterest);
        expect(current.fee).to.equal(feeAmount).to.equal(payments.currentFee);
      });
    
      it("delinquent (last installment) [last installment < time < last installment + period]", async () => {
        if (installments === 1) return;
        await time.increaseTo(lastInstallmentTime + 1n);
        
        // missed 1 installment
        lien.state.installment = BigInt(lien.installments) - 2n;
    
        const { status, balance, delinquent, current } = await kettle.lienStatus(lien)
          .then(({ status, balance, delinquent, current }) => ({
            status,
            balance,
            delinquent: parsePaymentDeadline(delinquent),
            current: parsePaymentDeadline(current)
        }));

        const payments = await kettle.payments(lien);
    
        // expect status to be delinquent
        expect(status).to.equal(1);
        expect(balance).to.equal(BigInt(lien.principal) + interestAmount + defaultInterestAmount + feeAmount * 2n).to.equal(payments.balance);
    
        // delinquent period maps to last missed payment
        expect(delinquent.periodStart).to.equal(lastInstallmentTime - period);
        expect(delinquent.deadline).to.equal(lastInstallmentTime + gracePeriod);
        expect(delinquent.principal).to.equal(0);
        expect(delinquent.interest).to.equal(defaultInterestAmount).to.equal(payments.pastInterest);
        expect(delinquent.fee).to.equal(feeAmount).to.equal(payments.pastFee);
    
        expect(current.periodStart).to.equal(lastInstallmentTime);
        expect(current.deadline).to.equal(lastInstallmentTime + period);
        expect(current.principal).to.equal(lien.principal).to.equal(payments.principal);
        expect(current.interest).to.equal(interestAmount).to.equal(payments.currentInterest);
        expect(current.fee).to.equal(feeAmount).to.equal(payments.currentFee);
      });
    
      it("delinquent (past end time) [end time < time < endtime + grace period]", async () => {
        await time.increase(endTime + 1n);
    
        // missed no installments except last
        lien.state.installment = BigInt(lien.installments) - 1n;
    
        const { status, balance, delinquent, current } = await kettle.lienStatus(lien)
          .then(({ status, balance, delinquent, current }) => ({
            status,
            balance,
            delinquent: parsePaymentDeadline(delinquent),
            current: parsePaymentDeadline(current)
        }));

        const payments = await kettle.payments(lien);

        expect(status).to.equal(2);
        expect(balance).to.equal(BigInt(lien.principal) + defaultInterestAmount + feeAmount).to.equal(payments.balance);
    
        expect(delinquent.periodStart).to.equal(lastInstallmentTime);
        expect(delinquent.deadline).to.equal(lastInstallmentTime + period + gracePeriod);
        expect(delinquent.principal).to.equal(lien.principal).to.equal(payments.principal);
        expect(delinquent.interest).to.equal(defaultInterestAmount).to.equal(payments.pastInterest);
        expect(delinquent.fee).to.equal(feeAmount).to.equal(payments.pastFee);
    
        expect(current.periodStart).to.equal(0);
        expect(current.deadline).to.equal(0);
        expect(current.principal).to.equal(0);
        expect(current.interest).to.equal(0).to.equal(payments.currentInterest);
        expect(current.fee).to.equal(0).to.equal(payments.currentFee);
      });
    });
  }
});
