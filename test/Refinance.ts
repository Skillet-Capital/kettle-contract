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
import { extractBorrowLog, extractRefinanceLog } from './helpers/events';
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

describe("Refinance", function () {

  let owner: Signer;
  let borrower: Signer;
  let lender: Signer;
  let lender2: Signer;
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
    lender2 = fixture.lender2;
    recipient = fixture.recipient;
    signers = fixture.signers;

    kettle = fixture.kettle;

    tokens = fixture.tokens;
    tokenId = fixture.tokenId;
    testErc721 = fixture.testErc721;

    principal = fixture.principal;
    testErc20 = fixture.testErc20;
  });

  let lienId: string | number | bigint;
  let lien: LienStruct;

  let refinanceOffer: LoanOfferStruct;
  let terms: LoanOfferTermsStruct;
  let collateral: CollateralStruct;

  let signature: string;

  let borrowerBalanceBefore: bigint;
  let recipientBalanceBefore: bigint;
  let lender1BalanceBefore: bigint;
  let lender2BalanceBefore: bigint;

  beforeEach(async () => {
    terms = {
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

    collateral = {
      collection: testErc721,
      criteria: 0,
      identifier: tokenId,
      size: 1
    }

    const offer = {
      lender: lender,
      recipient: recipient,
      terms,
      collateral,
      salt: randomBytes(),
      expiration: await time.latest() + DAY_SECONDS
    }

    signature = await signLoanOffer(kettle, lender, offer);

    const txn = await kettle.connect(borrower).borrow(offer, principal, 1, borrower, signature, []);
    ({ lienId, lien } = await txn.wait().then(receipt => extractBorrowLog(receipt!)));

    borrowerBalanceBefore = await testErc20.balanceOf(borrower);
    recipientBalanceBefore = await testErc20.balanceOf(recipient);
    lender1BalanceBefore = await testErc20.balanceOf(lender);
    lender2BalanceBefore = await testErc20.balanceOf(lender2);
  });

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

        refinanceOffer = {
          lender: lender2,
          recipient: recipient,
          terms,
          collateral,
          salt: randomBytes(),
          expiration: await time.latest() + DAY_SECONDS
        }

        signature = await signLoanOffer(kettle, lender2, refinanceOffer);
      });

      for (var i=0; i<2; i++) {
        const delinquent = i === 1;

        describe(`[${delinquent ? 'DELINQUENT' : 'CURRENT'}] should purchase a listed asset in a lien with a loan offer`, () => {
          beforeEach(async () => {
            if (delinquent) {
              await time.increase(MONTH_SECONDS + HALF_MONTH_SECONDS);
            }
          });

          it("amount > amountOwed", async () => {
            const { amountOwed, principal, currentInterest, currentFee, pastFee, pastInterest } = await kettle.amountOwed(lien);
            expect(pastFee).to.equal(!delinquent ? 0n : currentFee);
            expect(pastInterest).to.equal(!delinquent ? 0n : currentInterest);

            const refinanceAmount = principal * 2n;
      
            const txn = await kettle.connect(borrower).refinance(
              lienId,
              refinanceAmount,
              lien,
              refinanceOffer,
              signature,
              proof
            );
      
            expect(await testErc20.balanceOf(borrower)).to.be.within(
              borrowerBalanceBefore + refinanceAmount - principal - currentInterest - currentFee - pastInterest - pastFee - 1n, 
              borrowerBalanceBefore + refinanceAmount - principal - currentInterest - currentFee - pastInterest - pastFee + 1n, 
            );
            expect(await testErc20.balanceOf(recipient)).to.equal(recipientBalanceBefore + currentFee + pastFee);
            expect(await testErc20.balanceOf(lender)).to.equal(lender1BalanceBefore + principal + currentInterest + pastInterest);
            expect(await testErc20.balanceOf(lender2)).to.equal(lender2BalanceBefore - refinanceAmount);
          })
      
          it("amount > principal + interest", async () => {
            const { amountOwed, principal, currentInterest, currentFee, pastFee, pastInterest } = await kettle.amountOwed(lien);
            expect(pastFee).to.equal(!delinquent ? 0n : currentFee);
            expect(pastInterest).to.equal(!delinquent ? 0n : currentInterest);

            const refinanceAmount = principal + pastInterest + currentInterest + pastFee + (currentFee / 2n);
      
            const txn = await kettle.connect(borrower).refinance(
              lienId,
              refinanceAmount,
              lien,
              refinanceOffer,
              signature,
              proof
            );
      
            expect(await testErc20.balanceOf(borrower)).to.be.within(
              borrowerBalanceBefore - (currentFee / 2n) - 1n, 
              borrowerBalanceBefore - (currentFee / 2n) + 1n
            );
            expect(await testErc20.balanceOf(recipient)).to.equal(recipientBalanceBefore + currentFee + pastFee);
            expect(await testErc20.balanceOf(lender)).to.equal(lender1BalanceBefore + principal + currentInterest + pastInterest);
            expect(await testErc20.balanceOf(lender2)).to.equal(lender2BalanceBefore - refinanceAmount);
          });
      
          it("amount > principal", async () => {
            const { amountOwed, principal, currentInterest, currentFee, pastFee, pastInterest } = await kettle.amountOwed(lien);
            expect(pastFee).to.equal(!delinquent ? 0n : currentFee);
            expect(pastInterest).to.equal(!delinquent ? 0n : currentInterest);

            const refinanceAmount = principal + pastInterest + (currentInterest / 2n);
      
            const txn = await kettle.connect(borrower).refinance(
              lienId,
              refinanceAmount,
              lien,
              refinanceOffer,
              signature,
              proof
            );
      
            expect(await testErc20.balanceOf(borrower)).to.be.within(
              borrowerBalanceBefore - pastFee - currentFee - (currentInterest / 2n) - 1n, 
              borrowerBalanceBefore - pastFee - currentFee - (currentInterest / 2n) + 1n
            );
            expect(await testErc20.balanceOf(recipient)).to.equal(recipientBalanceBefore + currentFee + pastFee);
            expect(await testErc20.balanceOf(lender)).to.equal(lender1BalanceBefore + principal + currentInterest + pastInterest);
            expect(await testErc20.balanceOf(lender2)).to.equal(lender2BalanceBefore - refinanceAmount);
          });
      
          it("amount < principal", async () => {
            const { principal, currentInterest, currentFee, pastInterest, pastFee } = await kettle.amountOwed(lien);
            expect(pastFee).to.equal(!delinquent ? 0n : currentFee);
            expect(pastInterest).to.equal(!delinquent ? 0n : currentInterest);

            const refinanceAmount = principal / 2n;
      
            const txn = await kettle.connect(borrower).refinance(
              lienId,
              refinanceAmount,
              lien,
              refinanceOffer,
              signature,
              proof
            );
      
            expect(await testErc20.balanceOf(borrower)).to.equal(borrowerBalanceBefore - principal - currentFee - currentInterest - pastFee - pastInterest + refinanceAmount);
            expect(await testErc20.balanceOf(recipient)).to.equal(recipientBalanceBefore + currentFee + pastFee);
            expect(await testErc20.balanceOf(lender)).to.equal(lender1BalanceBefore + principal + currentInterest + pastInterest);
            expect(await testErc20.balanceOf(lender2)).to.equal(lender2BalanceBefore - refinanceAmount);
          })
        });
      }
    });
  }
});
