import {
  time,
  loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer, parseUnits } from "ethers";

import { getFixture } from './setup';
import { extractBorrowLog, extractSellInLienLog } from './helpers/events';
import { randomBytes, generateMerkleRootForCollection, generateMerkleProofForToken, hashIdentifier } from './helpers/merkle';

import {
  TestERC20,
  TestERC721,
  Kettle
} from "../typechain-types";
import { LienStruct, LoanOfferStruct, MarketOfferStruct } from "../typechain-types/contracts/Kettle";

const DAY_SECONDS = 86400;
const MONTH_SECONDS = DAY_SECONDS * 365 / 12;
const HALF_MONTH_SECONDS = MONTH_SECONDS / 2;

describe("Sell In Lien", function () {

  let owner: Signer;
  let borrower: Signer;
  let lender: Signer;
  let offerMaker: Signer;
  let recipient: Signer;

  let signers: Signer[];
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
    offerMaker = fixture.offerMaker;
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

  let bidOffer: MarketOfferStruct;

  beforeEach(async () => {
    const offer = {
      lender: lender,
      recipient: recipient,
      currency: testErc20,
      collection: testErc721,
      criteria: 0,
      identifier: tokenId,
      size: 1,
      totalAmount: principal,
      maxAmount: principal,
      minAmount: principal,
      tenor: DAY_SECONDS * 365,
      period: MONTH_SECONDS,
      rate: "1000",
      fee: "200",
      gracePeriod: MONTH_SECONDS
    }

    const txn = await kettle.connect(borrower).borrow(offer, principal, 1, borrower, []);
    ({ lienId, lien } = await txn.wait().then(receipt => extractBorrowLog(receipt!))
    );

    bidOffer = {
      side: 0,
      maker: offerMaker,
      currency: testErc20,
      collection: testErc721,
      criteria: 0,
      identifier: tokenId,
      size: 1,
      amount: principal,
      withLoan: false,
      borrowAmount: 0
    }
  })

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
      });

      for (var i = 0; i < 2; i++) {
        const delinquent = i === 1;

        describe(`[${delinquent ? 'DELINQUENT' : 'CURRENT'}] should sell an asset in a lien into a bid`, () => {
          let borrowerBalanceBefore: bigint;
          let recipientBalanceBefore: bigint;
          let lenderBalanceBefore: bigint;
          let bidderBalanceBefore: bigint;

          beforeEach(async () => {
            if (delinquent) {
              await time.increase(MONTH_SECONDS + HALF_MONTH_SECONDS);
            }

            expect(await testErc721.ownerOf(tokenId)).to.eq(kettle);
            borrowerBalanceBefore = await testErc20.balanceOf(borrower);
            recipientBalanceBefore = await testErc20.balanceOf(recipient);
            lenderBalanceBefore = await testErc20.balanceOf(lender);
            bidderBalanceBefore = await testErc20.balanceOf(offerMaker);
          })

          it("bid amount > amountOwed", async () => {
            const { amountOwed, principal, currentInterest, currentFee, pastFee, pastInterest } = await kettle.amountOwed(lien);
            expect(pastFee).to.equal(!delinquent ? 0n : currentFee);
            expect(pastInterest).to.equal(!delinquent ? 0n : currentInterest);

            const bidAmount = principal * 2n;

            const txn = await kettle.connect(borrower).sellInLien(
              lienId,
              lien,
              { ...bidOffer, amount: bidAmount, criteria, identifier },
              proof
            );

            // after checks
            expect(await testErc721.ownerOf(tokenId)).to.equal(offerMaker);
            expect(await testErc20.balanceOf(offerMaker)).to.equal(bidderBalanceBefore - bidAmount);

            expect(await testErc20.balanceOf(borrower)).to.be.within(
              borrowerBalanceBefore + bidAmount - principal - currentInterest - currentFee - pastFee - pastInterest - 1n,
              borrowerBalanceBefore + bidAmount - principal - currentInterest - currentFee - pastFee - pastInterest + 1n,
            );

            expect(await testErc20.balanceOf(recipient)).to.equal(recipientBalanceBefore + currentFee + pastFee);
            expect(await testErc20.balanceOf(lender)).to.equal(lenderBalanceBefore + principal + currentInterest + pastInterest);

            // log checks
            const sellInLienLog = await txn.wait().then(receipt => extractSellInLienLog(receipt!));
            expect(sellInLienLog.lienId).to.equal(lienId);
            expect(sellInLienLog.buyer).to.equal(bidOffer.maker).to.equal(offerMaker);
            expect(sellInLienLog.seller).to.equal(borrower);
            expect(sellInLienLog.currency).to.equal(testErc20);
            expect(sellInLienLog.collection).to.equal(testErc721);
            expect(sellInLienLog.tokenId).to.equal(tokenId);
            expect(sellInLienLog.size).to.equal(1);
            expect(sellInLienLog.bidAmount).to.equal(bidAmount);
            expect(sellInLienLog.amountOwed).to.equal(amountOwed);
            expect(sellInLienLog.principal).to.equal(principal);
            expect(sellInLienLog.currentInterest).to.equal(currentInterest);
            expect(sellInLienLog.currentFee).to.equal(currentFee);
            expect(sellInLienLog.pastInterest).to.equal(delinquent ? currentInterest : 0);
            expect(sellInLienLog.pastFee).to.equal(delinquent ? currentFee : 0);
          });

          it("amountOwed > bid amount > principal + interest", async () => {
            const { amountOwed, principal, currentInterest, currentFee, pastFee, pastInterest } = await kettle.amountOwed(lien);
            expect(pastFee).to.equal(!delinquent ? 0n : currentFee);
            expect(pastInterest).to.equal(!delinquent ? 0n : currentInterest);

            const bidAmount = principal + currentInterest + pastInterest + pastFee + (currentFee / 2n);

            const txn = await kettle.connect(borrower).sellInLien(
              lienId,
              lien,
              { ...bidOffer, amount: bidAmount, criteria, identifier },
              proof
            );

            // after checks
            expect(await testErc721.ownerOf(tokenId)).to.equal(offerMaker);
            expect(await testErc20.balanceOf(offerMaker)).to.equal(bidderBalanceBefore - bidAmount);

            expect(await testErc20.balanceOf(borrower)).to.be.within(
              borrowerBalanceBefore - (currentFee / 2n) - 1n,
              borrowerBalanceBefore - (currentFee / 2n) + 1n
            );

            expect(await testErc20.balanceOf(recipient)).to.equal(recipientBalanceBefore + currentFee + pastFee);
            expect(await testErc20.balanceOf(lender)).to.equal(lenderBalanceBefore + principal + currentInterest + pastInterest);

            // log checks
            const sellInLienLog = await txn.wait().then(receipt => extractSellInLienLog(receipt!));
            expect(sellInLienLog.lienId).to.equal(lienId);
            expect(sellInLienLog.buyer).to.equal(bidOffer.maker).to.equal(offerMaker);
            expect(sellInLienLog.seller).to.equal(borrower);
            expect(sellInLienLog.currency).to.equal(testErc20);
            expect(sellInLienLog.collection).to.equal(testErc721);
            expect(sellInLienLog.tokenId).to.equal(tokenId);
            expect(sellInLienLog.size).to.equal(1);
            expect(sellInLienLog.bidAmount).to.equal(bidAmount);
            expect(sellInLienLog.amountOwed).to.equal(amountOwed);
            expect(sellInLienLog.principal).to.equal(principal);
            expect(sellInLienLog.currentInterest).to.equal(currentInterest);
            expect(sellInLienLog.currentFee).to.equal(currentFee);
            expect(sellInLienLog.pastInterest).to.equal(delinquent ? currentInterest : 0);
            expect(sellInLienLog.pastFee).to.equal(delinquent ? currentFee : 0);
          });

          it("amountOwed > bid amount > principal", async () => {
            const { amountOwed, principal, currentInterest, currentFee, pastFee, pastInterest } = await kettle.amountOwed(lien);
            expect(pastFee).to.equal(!delinquent ? 0n : currentFee);
            expect(pastInterest).to.equal(!delinquent ? 0n : currentInterest);

            const bidAmount = principal + pastInterest + (currentInterest / 2n);
            const txn = await kettle.connect(borrower).sellInLien(
              lienId,
              lien,
              { ...bidOffer, amount: bidAmount, criteria, identifier },
              proof
            );

            // after checks
            expect(await testErc721.ownerOf(tokenId)).to.equal(offerMaker);
            expect(await testErc20.balanceOf(offerMaker)).to.equal(bidderBalanceBefore - bidAmount);

            expect(await testErc20.balanceOf(borrower)).to.be.within(
              borrowerBalanceBefore - (currentInterest / 2n) - currentFee - pastFee - 1n,
              borrowerBalanceBefore - (currentInterest / 2n) - currentFee - pastFee + 1n
            );

            expect(await testErc20.balanceOf(recipient)).to.equal(recipientBalanceBefore + currentFee + pastFee);
            expect(await testErc20.balanceOf(lender)).to.equal(lenderBalanceBefore + principal + currentInterest + pastInterest);

            // log checks
            const sellInLienLog = await txn.wait().then(receipt => extractSellInLienLog(receipt!));
            expect(sellInLienLog.lienId).to.equal(lienId);
            expect(sellInLienLog.buyer).to.equal(bidOffer.maker).to.equal(offerMaker);
            expect(sellInLienLog.seller).to.equal(borrower);
            expect(sellInLienLog.currency).to.equal(testErc20);
            expect(sellInLienLog.collection).to.equal(testErc721);
            expect(sellInLienLog.tokenId).to.equal(tokenId);
            expect(sellInLienLog.size).to.equal(1);
            expect(sellInLienLog.bidAmount).to.equal(bidAmount);
            expect(sellInLienLog.amountOwed).to.equal(amountOwed);
            expect(sellInLienLog.principal).to.equal(principal);
            expect(sellInLienLog.currentInterest).to.equal(currentInterest);
            expect(sellInLienLog.currentFee).to.equal(currentFee);
            expect(sellInLienLog.pastInterest).to.equal(delinquent ? currentInterest : 0);
            expect(sellInLienLog.pastFee).to.equal(delinquent ? currentFee : 0);
          });

          it("bid amount < principal", async () => {
            const { amountOwed, principal, currentInterest, currentFee, pastFee, pastInterest } = await kettle.amountOwed(lien);
            expect(pastFee).to.equal(!delinquent ? 0n : currentFee);
            expect(pastInterest).to.equal(!delinquent ? 0n : currentInterest);

            const bidAmount = principal / 2n;
            const txn = await kettle.connect(borrower).sellInLien(
              lienId,
              lien,
              { ...bidOffer, amount: bidAmount, criteria, identifier },
              proof
            );

            // after checks
            expect(await testErc20.balanceOf(offerMaker)).to.equal(bidderBalanceBefore - bidAmount);
            expect(await testErc20.balanceOf(borrower)).to.be.within(
              borrowerBalanceBefore - (principal / 2n) - currentInterest - currentFee - pastInterest - pastFee - 1n,
              borrowerBalanceBefore - (principal / 2n) - currentInterest - currentFee - pastInterest - pastFee + 1n
            );
            expect(await testErc20.balanceOf(recipient)).to.equal(recipientBalanceBefore + currentFee + pastFee);
            expect(await testErc20.balanceOf(lender)).to.equal(lenderBalanceBefore + principal + currentInterest + pastInterest);

            // log checks
            const sellInLienLog = await txn.wait().then(receipt => extractSellInLienLog(receipt!));
            expect(sellInLienLog.lienId).to.equal(lienId);
            expect(sellInLienLog.buyer).to.equal(bidOffer.maker).to.equal(offerMaker);
            expect(sellInLienLog.seller).to.equal(borrower);
            expect(sellInLienLog.currency).to.equal(testErc20);
            expect(sellInLienLog.collection).to.equal(testErc721);
            expect(sellInLienLog.tokenId).to.equal(tokenId);
            expect(sellInLienLog.size).to.equal(1);
            expect(sellInLienLog.bidAmount).to.equal(bidAmount);
            expect(sellInLienLog.amountOwed).to.equal(amountOwed);
            expect(sellInLienLog.principal).to.equal(principal);
            expect(sellInLienLog.currentInterest).to.equal(currentInterest);
            expect(sellInLienLog.currentFee).to.equal(currentFee);
            expect(sellInLienLog.pastInterest).to.equal(delinquent ? currentInterest : 0);
            expect(sellInLienLog.pastFee).to.equal(delinquent ? currentFee : 0);
          });
        });
      }
    });
  }

  it('should fail if lien is defaulted', async () => {
    await time.increase(MONTH_SECONDS + MONTH_SECONDS);

    await expect(kettle.connect(borrower).sellInLien(
      lienId,
      lien,
      bidOffer,
      []
    )).to.be.revertedWithCustomError(kettle, "LienDefaulted");
  })

  it('should fail if side is not bid', async () => {
    await expect(kettle.connect(borrower).sellInLien(
      lienId,
      lien,
      { ...bidOffer, side: 1 },
      []
    )).to.be.revertedWithCustomError(kettle, "OfferNotBid");
  });

  it('should fail if collections do not match', async () => {
    await expect(kettle.connect(borrower).sellInLien(
      lienId,
      lien,
      { ...bidOffer, collection: testErc20 },
      []
    )).to.be.revertedWithCustomError(kettle, "CollectionMismatch");
  })

  it('should fail if currencies do not match', async () => {
    await expect(kettle.connect(borrower).sellInLien(
      lienId,
      lien,
      { ...bidOffer, currency: testErc721 },
      []
    )).to.be.revertedWithCustomError(kettle, "CurrencyMismatch");
  })

  it('should fail if sizes do not match', async () => {
    await expect(kettle.connect(borrower).sellInLien(
      lienId,
      lien,
      { ...bidOffer, size: 2 },
      []
    )).to.be.revertedWithCustomError(kettle, "SizeMismatch");
  })
});
