import {
  time,
  loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer, parseUnits } from "ethers";

import { getFixture } from './setup';
import { signLoanOffer } from "./helpers/signatures";
import { extractBorrowLog, extractPaymentLog, extractRepayLog } from './helpers/events';
import { randomBytes, generateMerkleRootForCollection, generateMerkleProofForToken, hashIdentifier } from './helpers/merkle';

import {
  TestERC20,
  TestERC721,
  Kettle
} from "../typechain-types";
import { LienStruct, LoanOfferStruct, LoanOfferTermsStruct, CollateralStruct, MarketOfferStruct, MarketOfferTermsStruct, FeeTermsStruct } from "../typechain-types/contracts/Kettle";

const DAY_SECONDS = 86400;
const MONTH_SECONDS = DAY_SECONDS * 365 / 12;
const HALF_MONTH_SECONDS = MONTH_SECONDS / 2;

describe("Loan", function () {

  let owner: Signer;
  let borrower: Signer;
  let lender: Signer;
  let recipient: Signer;

  let kettle: Kettle;

  let tokens: number[];
  let tokenId: number;
  let principal: bigint;

  let testErc721: TestERC721;
  let testErc20: TestERC20;

  beforeEach(async () => {
    const fixture = await getFixture();
    owner = fixture.owner;
    borrower = fixture.borrower;
    lender = fixture.lender;
    recipient = fixture.recipient;

    kettle = fixture.kettle;

    tokens = fixture.tokens;
    tokenId = fixture.tokenId;
    principal = fixture.principal;

    testErc721 = fixture.testErc721;
    testErc20 = fixture.testErc20;
  });

  for (const criteria of [0, 1]) {
    describe(`criteria: ${criteria == 0 ? "SIMPLE" : "PROOF"}`, () => {
      let lienId: string | number | bigint;
      let lien: LienStruct;

      let proof: string[];
      let identifier: bigint;

      beforeEach(async () => {
        if (criteria === 0) {
          proof = [];
          identifier = BigInt(tokenId);
        } else {
          proof = generateMerkleProofForToken(tokens, tokenId);
          identifier = BigInt(generateMerkleRootForCollection(tokens));
        }

        const fee: FeeTermsStruct = {
          recipient,
          rate: "200"
        }

        const terms: LoanOfferTermsStruct = {
          currency: testErc20,
          totalAmount: principal,
          maxAmount: principal,
          minAmount: principal,
          rate: "1000",
          defaultRate: "2000",
          period: MONTH_SECONDS,
          gracePeriod: MONTH_SECONDS,
          installments: 12
        }
    
        const collateral: CollateralStruct = {
          collection: testErc721,
          criteria: criteria,
          identifier: identifier,
          size: 1
        }

        const loanOffer = {
          lender: lender,
          terms,
          collateral,
          fee,
          salt: randomBytes(),
          expiration: await time.latest() + DAY_SECONDS
        }

        const signature = await signLoanOffer(kettle, lender, loanOffer);
    
        const txn = await kettle.connect(borrower).borrow(loanOffer, principal, tokenId, borrower, signature, proof);
        ({ lienId, lien } = await txn.wait().then(receipt => extractBorrowLog(receipt!)));
      })
    
      it("should make interest payment and be current until next payment", async () => {
        await time.increase(1n);
        
        const paymentsResponse = await kettle.payments(lien);
        const { status } = await kettle.lienStatus(lien);
        expect(status).to.equal(0);

        const txn = await kettle.connect(borrower).interestPayment(
          lienId, 
          lien
        );
    
        const paymentLog = await txn.wait().then(receipt => extractPaymentLog(receipt!));
        expect(paymentLog).to.deep.equal({
          lienId,
          installment: 0n,
          principal: 0n,
          pastInterest: 0n,
          pastFee: 0n,
          currentInterest: paymentsResponse.currentInterest,
          currentFee: paymentsResponse.currentFee,
          newPrincipal: lien.principal,
          newInstallment: 1n
        });
      });
    
      it("should make interest, attemp additional interest payment, and still be paid through same period", async () => {
        await time.increase(HALF_MONTH_SECONDS);
        
        const paymentsResponse = await kettle.payments(lien);
        const { status } = await kettle.lienStatus(lien);
        expect(status).to.equal(0);
        
        let txn = await kettle.connect(borrower).interestPayment(
          lienId,
          lien
        );
    
        const paymentLog1 = await txn.wait().then(receipt => extractPaymentLog(receipt!));
        expect(paymentLog1).to.deep.equal({
          lienId,
          installment: 0n,
          principal: 0n,
          pastInterest: 0n,
          pastFee: 0n,
          currentInterest: paymentsResponse.currentInterest,
          currentFee: paymentsResponse.currentFee,
          newPrincipal: lien.principal,
          newInstallment: 1n
        });
    
        lien.state = {
          installment: paymentLog1.newInstallment,
          principal: paymentLog1.newPrincipal
        }
        
        // attempt an additional payment in the same period
        txn = await kettle.connect(borrower).interestPayment(
          lienId, 
          lien
        );
        const paymentLog2 = await txn.wait().then(receipt => extractPaymentLog(receipt!));
        expect(paymentLog2).to.deep.equal({
          lienId,
          installment: 1n,
          pastInterest: 0n,
          pastFee: 0n,
          currentInterest: 0n,
          currentFee: 0n,
          principal: 0n,
          newPrincipal: lien.principal,
          newInstallment: 1n
        });
      });
    
      it("should pay interest and some principal and be current until next payment", async () => {
        await time.increase(HALF_MONTH_SECONDS);
        
        const paymentsResponse = await kettle.payments(lien);
        const { status } = await kettle.lienStatus(lien);
        expect(status).to.equal(0);
        
        const principalPayment = BigInt(lien.principal) / 2n;
        const txn = await kettle.connect(borrower).principalPayment(
          lienId, 
          principalPayment,
          lien
        );
    
        const paymentLog = await txn.wait().then(receipt => extractPaymentLog(receipt!));
        expect(paymentLog).to.deep.equal({
          lienId,
          installment: 0n,
          principal: principalPayment,
          pastInterest: 0n,
          pastFee: 0n,
          currentInterest: paymentsResponse.currentInterest,
          currentFee: paymentsResponse.currentFee,
          newPrincipal: BigInt(lien.principal) - principalPayment,
          newInstallment: 1n
        });    
      });
    
      it("should make cure payment in default and be current through one period", async () => {
        await time.increase(MONTH_SECONDS + HALF_MONTH_SECONDS);
        
        const paymentsResponse = await kettle.payments(lien);
        const { status } = await kettle.lienStatus(lien);
        expect(status).to.equal(1);
    
        const txn = await kettle.connect(borrower).curePayment(
          lienId, 
          lien
        );
    
        const paymentLog = await txn.wait().then(receipt => extractPaymentLog(receipt!));
        expect(paymentLog).to.deep.equal({
          lienId,
          installment: 0n,
          principal: 0n,
          pastInterest: paymentLog.pastInterest,
          pastFee: paymentLog.pastFee,
          currentInterest: 0n,
          currentFee: 0n,
          newPrincipal: lien.principal,
          newInstallment: 1n
        }); 
      });
    
      it("should make interest payment in default and be current through two periods", async () => {
        await time.increase(MONTH_SECONDS + HALF_MONTH_SECONDS);
        
        const paymentsResponse = await kettle.payments(lien);
        const { status } = await kettle.lienStatus(lien);
        expect(status).to.equal(1);
    
        const txn = await kettle.connect(borrower).interestPayment(
          lienId, 
          lien
        );
    
        const paymentLog = await txn.wait().then(receipt => extractPaymentLog(receipt!));
        expect(paymentLog).to.deep.equal({
          lienId,
          installment: 0n,
          principal: 0n,
          pastInterest: paymentLog.pastInterest,
          pastFee: paymentLog.pastFee,
          currentInterest: paymentsResponse.currentInterest,
          currentFee: paymentsResponse.currentFee,
          newPrincipal: lien.principal,
          newInstallment: 2n
        });
      });
    
      it("should fail to make interest payment after default period and lender should claim", async () => {
        await time.increaseTo(BigInt(lien.startTime) + (BigInt(lien.period) * 3n));
    
        const { status } = await kettle.lienStatus(lien);
        expect(status).to.equal(2);
    
        await expect(kettle.connect(borrower).interestPayment(
          lienId, 
          lien
        )).to.be.revertedWithCustomError(kettle, "LienDefaulted");
    
        await kettle.claim(lienId, lien);
    
        expect(await testErc721.ownerOf(tokenId)).to.equal(await lender.getAddress());
      });
    
      it("should fail to cure payment after default period", async () => {
        await time.increaseTo(BigInt(lien.startTime) + (BigInt(lien.period) * 3n));
    
        const { status } = await kettle.lienStatus(lien);
        expect(status).to.equal(2);
    
        await expect(kettle.connect(borrower).curePayment(
          lienId, 
          lien
        )).to.be.revertedWithCustomError(kettle, "LienDefaulted");
      });
    
      it('should repay lien before tenor', async () => {
        await time.increaseTo(BigInt(lien.startTime) + (BigInt(lien.period) / 2n));
    
        const paymentsResponse = await kettle.payments(lien);
        await testErc20.mint(borrower, paymentsResponse.balance);
    
        const txn = await kettle.connect(borrower).repay(
          lienId, 
          lien
        );
    
        const repayLog = await txn.wait().then(receipt => extractRepayLog(receipt!));
        expect(repayLog).to.deep.equal({
          lienId,
          installment: 0,
          balance: paymentsResponse.balance,
          principal: lien.principal,
          pastInterest: 0,
          pastFee: 0,
          currentInterest: paymentsResponse.currentInterest,
          currentFee: paymentsResponse.currentFee
        });
      });
    
      it('should repay lien after tenor', async () => {
        for (let i = 0; i < 11; i++) {
          await time.increase(BigInt(HALF_MONTH_SECONDS));
          const txn = await kettle.connect(borrower).interestPayment(
            lienId, 
            lien
          );
    
          const paymentLog = await txn.wait().then(receipt => extractPaymentLog(receipt!));
    
          lien.state = {
            installment: paymentLog.newInstallment,
            principal: paymentLog.newPrincipal
          }
    
          await time.increase(BigInt(HALF_MONTH_SECONDS))
        }
    
        // before we go past tenor, all interest owed is just the current period
        await kettle.lienStatus(lien).then(({ status }) => expect(status).to.equal(0));    
        await time.increase(BigInt(lien.period) * 3n / 2n);
    
        const { balance } = await kettle.payments(lien);
        await testErc20.mint(borrower, balance);
        
        const paymentsResponse = await kettle.payments(lien);
        await kettle.lienStatus(lien).then(({ status }) => expect(status).to.equal(1));
    
        const txn = await kettle.connect(borrower).repay(
          lienId, 
          lien
        );
    
        const repayLog = await txn.wait().then(receipt => extractRepayLog(receipt!));
        expect(repayLog).to.deep.equal({
          lienId,
          installment: 11,
          principal: lien.principal,
          balance: balance,
          pastInterest: paymentsResponse.pastInterest,
          pastFee: paymentsResponse.pastFee,
          currentInterest: 0n,
          currentFee: 0n
        });
      });
    });
  }
});
