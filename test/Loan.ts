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
import { LienStruct, LoanOfferStruct, LoanOfferTermsStruct, CollateralStruct, MarketOfferStruct, MarketOfferTermsStruct } from "../typechain-types/contracts/Kettle";

const DAY_SECONDS = 86400;
const MONTH_SECONDS = DAY_SECONDS * 365 / 12;
const HALF_MONTH_SECONDS = MONTH_SECONDS / 2;

describe("Loan", function () {

  let owner: Signer;
  let borrower: Signer;
  let lender: Signer;
  let recipient: Signer;

  let signers: Signer[];
  let kettle: Kettle;

  let tokens: number[];
  let tokenId: number;
  let testErc721: TestERC721;

  let principal: bigint;
  let testErc20: TestERC20;


  beforeEach(async () => {
    const fixture = await getFixture();
    owner = fixture.owner;
    borrower = fixture.borrower;
    lender = fixture.lender;
    recipient = fixture.recipient;
    signers = fixture.signers;

    kettle = fixture.kettle;

    tokens = fixture.tokens;
    tokenId = fixture.tokenId;
    principal = fixture.principal;

    testErc721 = fixture.testErc721;
    testErc20 = fixture.testErc20;
  });

  let lienId: string | number | bigint;
  let lien: LienStruct;

  for (const criteria of [0, 1]) {
    describe(`criteria: ${criteria == 0 ? "SIMPLE" : "PROOF"}`, () => {
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

        const loanOfferTerms: LoanOfferTermsStruct = {
          currency: testErc20,
          totalAmount: principal,
          maxAmount: principal,
          minAmount: principal,
          tenor: DAY_SECONDS * 365,
          period: MONTH_SECONDS,
          rate: "1000",
          fee: "200",
          gracePeriod: MONTH_SECONDS
        }
    
        const collateral: CollateralStruct = {
          collection: testErc721,
          criteria: criteria,
          identifier: identifier,
          size: 1
        }

        const loanOffer = {
          lender: lender,
          recipient: recipient,
          terms: loanOfferTerms,
          collateral,
          salt: randomBytes(),
          expiration: await time.latest() + DAY_SECONDS
        }

        const signature = await signLoanOffer(kettle, lender, loanOffer);
    
        const txn = await kettle.connect(borrower).borrow(loanOffer, principal, tokenId, borrower, signature, proof);
        ({ lienId, lien } = await txn.wait().then(receipt => extractBorrowLog(receipt!)));
      })
    
      it("should make interest payment and be current until next payment", async () => {
        await time.increaseTo(BigInt(lien.startTime) + BigInt(HALF_MONTH_SECONDS));
        
        const paymentsResponse = await kettle.payments(lien);
        const status = await kettle.lienStatus(lien);
        expect(status).to.equal(0);

        const txn = await kettle.connect(borrower).interestPayment(
          lienId, 
          lien
        );
    
        const paymentLog = await txn.wait().then(receipt => extractPaymentLog(receipt!));
        expect(paymentLog).to.deep.equal({
          lienId,
          principal: 0n,
          pastInterest: 0n,
          pastFee: 0n,
          currentInterest: paymentsResponse.currentInterest,
          currentFee: paymentsResponse.currentFee,
          newPrincipal: lien.principal,
          paidThrough: BigInt(lien.startTime) + BigInt(lien.period)
        });
    
        lien.state = {
          paidThrough: paymentLog.paidThrough,
          principal: paymentLog.newPrincipal
        }
    
        expect(await kettle.nextPaymentDate(lien)).to.equal(BigInt(lien.startTime) + BigInt(lien.period) * 2n);
        expect(await kettle.payments(lien)).to.deep.equal([
          lien.principal,
          lien.principal,
          0n,
          0n,
          0n,
          0n
        ]);
      });
    
      it("should make interest, attemp additional interest payment, and still be paid through same period", async () => {
        await time.increase(HALF_MONTH_SECONDS);
        
        const paymentsResponse = await kettle.payments(lien);
        const status = await kettle.lienStatus(lien);
        expect(status).to.equal(0);
        
        let txn = await kettle.connect(borrower).interestPayment(
          lienId,
          lien
        );
    
        const paymentLog1 = await txn.wait().then(receipt => extractPaymentLog(receipt!));
        expect(paymentLog1).to.deep.equal({
          lienId,
          principal: 0n,
          pastInterest: 0n,
          pastFee: 0n,
          currentInterest: paymentsResponse.currentInterest,
          currentFee: paymentsResponse.currentFee,
          newPrincipal: lien.principal,
          paidThrough: BigInt(lien.startTime) + BigInt(lien.period)
        });
    
        lien.state = {
          paidThrough: paymentLog1.paidThrough,
          principal: paymentLog1.newPrincipal
        }
    
        expect(await kettle.nextPaymentDate(lien)).to.equal(BigInt(lien.startTime) + BigInt(lien.period) * 2n);
        expect(await kettle.payments(lien)).to.deep.equal([
          lien.principal,
          lien.principal,
          0n,
          0n,
          0n,
          0n
        ]);
    
        // attempt an additional payment in the same period
        txn = await kettle.connect(borrower).interestPayment(
          lienId, 
          lien
        );
        const paymentLog2 = await txn.wait().then(receipt => extractPaymentLog(receipt!));
        expect(paymentLog2).to.deep.equal({
          lienId,
          pastInterest: 0n,
          pastFee: 0n,
          currentInterest: 0n,
          currentFee: 0n,
          principal: 0n,
          newPrincipal: lien.principal,
          paidThrough: paymentLog1.paidThrough
        });
    
        lien.state = {
          paidThrough: paymentLog2.paidThrough,
          principal: paymentLog2.newPrincipal
        }
    
        expect(await kettle.nextPaymentDate(lien)).to.equal(BigInt(lien.startTime) + BigInt(lien.period) * 2n);
        expect(await kettle.payments(lien)).to.deep.equal([
          lien.principal,
          lien.principal,
          0n,
          0n,
          0n,
          0n
        ]);
    
        // fast forward to next period
        await time.increaseTo(BigInt(lien.startTime) + BigInt(MONTH_SECONDS) + BigInt(HALF_MONTH_SECONDS));
        await kettle.payments(lien).then(
          (payments) => expect(payments).to.deep.equal(paymentsResponse)
        );
      });
    
      it("should pay interest and some principal and be current until next payment", async () => {
        await time.increase(HALF_MONTH_SECONDS);
        
        const paymentsResponse = await kettle.payments(lien);
        const status = await kettle.lienStatus(lien);
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
          principal: principalPayment,
          pastInterest: 0n,
          pastFee: 0n,
          currentInterest: paymentsResponse.currentInterest,
          currentFee: paymentsResponse.currentFee,
          newPrincipal: BigInt(lien.principal) - principalPayment,
          paidThrough: BigInt(lien.startTime) + BigInt(lien.period)
        });
    
        lien.state = {
          paidThrough: paymentLog.paidThrough,
          principal: paymentLog.newPrincipal
        }
    
        expect(await kettle.nextPaymentDate(lien)).to.equal(BigInt(lien.startTime) + BigInt(lien.period) * 2n);
        expect(await kettle.payments(lien)).to.deep.equal([
          BigInt(lien.principal) - principalPayment,
          paymentLog.newPrincipal,
          0n,
          0n,
          0n,
          0n
        ]);
    
        // fast forward to next period
        await time.increase(MONTH_SECONDS);
        expect(await kettle.payments(lien)).to.deep.equal([
          paymentLog.newPrincipal + ((83333333n + 16666666n) / 2n),
          paymentLog.newPrincipal,
          0n,
          0n,
          83333333n / 2n,
          16666666n / 2n
        ]);
      });
    
      it("should make cure payment in default and be current through one period", async () => {
        await time.increase(MONTH_SECONDS + HALF_MONTH_SECONDS);
        
        const paymentsResponse = await kettle.payments(lien);
        const status = await kettle.lienStatus(lien);
        expect(status).to.equal(1);
    
        expect(paymentsResponse).to.deep.equal([
          BigInt(lien.principal) + 83333333n + 16666666n + 83333333n + 16666666n,
          BigInt(lien.principal),
          83333333n,
          16666666n,
          83333333n,
          16666666n
        ]);
        
        const txn = await kettle.connect(borrower).curePayment(
          lienId, 
          lien
        );
    
        const paymentLog = await txn.wait().then(receipt => extractPaymentLog(receipt!));
        expect(paymentLog).to.deep.equal({
          lienId,
          principal: 0n,
          pastInterest: paymentLog.pastInterest,
          pastFee: paymentLog.pastFee,
          currentInterest: 0n,
          currentFee: 0n,
          newPrincipal: lien.principal,
          paidThrough: BigInt(lien.startTime) + BigInt(lien.period)
        });
    
        lien.state = {
          paidThrough: paymentLog.paidThrough,
          principal: paymentLog.newPrincipal
        }
    
        expect(await kettle.nextPaymentDate(lien)).to.equal(BigInt(lien.startTime) + BigInt(lien.period) * 2n);
        expect(await kettle.payments(lien).then(({ balance }) => balance)).to.equal(BigInt(lien.principal) + paymentsResponse.currentInterest + paymentsResponse.currentFee); 
      });
    
      it("should make interest payment in default and be current through two periods", async () => {
        await time.increase(MONTH_SECONDS + HALF_MONTH_SECONDS);
        
        const paymentsResponse = await kettle.payments(lien);
        const status = await kettle.lienStatus(lien);
        expect(status).to.equal(1);
    
        expect(await kettle.nextPaymentDate(lien)).to.equal(BigInt(lien.startTime) + BigInt(lien.period) + BigInt(lien.gracePeriod));
    
        const txn = await kettle.connect(borrower).interestPayment(
          lienId, 
          lien
        );
    
        const paymentLog = await txn.wait().then(receipt => extractPaymentLog(receipt!));
        expect(paymentLog).to.deep.equal({
          lienId,
          principal: 0n,
          pastInterest: paymentLog.pastInterest,
          pastFee: paymentLog.pastFee,
          currentInterest: paymentsResponse.currentInterest,
          currentFee: paymentsResponse.currentFee,
          newPrincipal: lien.principal,
          paidThrough: BigInt(lien.startTime) + BigInt(lien.period) * 2n
        });
    
        lien.state = {
          paidThrough: paymentLog.paidThrough,
          principal: paymentLog.newPrincipal
        }
    
        expect(await kettle.nextPaymentDate(lien)).to.equal(BigInt(lien.startTime) + BigInt(lien.period) * 3n);
        expect(await kettle.payments(lien)).to.deep.equal([
          lien.principal,
          lien.principal,
          0n,
          0n,
          0n,
          0n
        ]);
      });
    
      it("should fail to make interest payment after default period and lender should claim", async () => {
        await time.increaseTo(BigInt(lien.startTime) + (BigInt(lien.period) * 3n));
    
        const status = await kettle.lienStatus(lien);
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
    
        const status = await kettle.lienStatus(lien);
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
          balance: paymentsResponse.balance,
          principal: lien.principal,
          pastInterest: 0,
          pastFee: 0,
          currentInterest: 83333333n,
          currentFee: 16666666n
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
            paidThrough: paymentLog.paidThrough,
            principal: paymentLog.newPrincipal
          }
    
          await time.increase(BigInt(HALF_MONTH_SECONDS))
        }
    
        // before we go past tenor, all interest owed is just the current period
        await kettle.lienStatus(lien).then((state) => expect(state).to.equal(0));
        await kettle.payments(lien).then(
          ({ pastInterest, pastFee, currentInterest, currentFee }) => expect({
            pastInterest,
            pastFee,
            currentInterest,
            currentFee
          }).to.deep.equal({
            pastInterest: 0n,
            pastFee: 0n,
            currentInterest: 83333333n,
            currentFee: 16666666n
          }));
        
        await time.increase(BigInt(lien.period) * 3n / 2n);
        expect(await time.latest()).to.be.above(BigInt(lien.startTime) + BigInt(lien.tenor))
    
        // after we go past tenor, we owe all past interest, but no more current interest
        await kettle.payments(lien).then(
          ({ pastInterest, pastFee, currentInterest, currentFee }) => expect({
            pastInterest,
            pastFee,
            currentInterest,
            currentFee
          }).to.deep.equal({
            pastInterest: 83333333n,
            pastFee: 16666666n,
            currentInterest: 0n,
            currentFee: 0n
          }));
    
        const { balance } = await kettle.payments(lien);
        await testErc20.mint(borrower, balance);
    
        await kettle.lienStatus(lien).then((state) => expect(state).to.equal(1));
    
        const txn = await kettle.connect(borrower).repay(
          lienId, 
          lien
        );
    
        const repayLog = await txn.wait().then(receipt => extractRepayLog(receipt!));
        expect(repayLog).to.deep.equal({
          lienId,
          principal: lien.principal,
          balance: balance,
          pastInterest: 83333333n,
          pastFee: 16666666n,
          currentInterest: 0n,
          currentFee: 0n
        });
      });
    });
  }
});
