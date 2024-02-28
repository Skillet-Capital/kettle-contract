import {
  time,
  loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer, parseUnits } from "ethers";

import { getFixture } from './setup';
import { extractBorrowLog, extractBuyInLienWithLoanLog } from './helpers/events';
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

describe("Sell In Lien With Loan", function () {

  let owner: Signer;
  let borrower: Signer;
  let lender: Signer;
  let lender2: Signer;
  let buyer: Signer;
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
    buyer = fixture.offerMaker;
    recipient = fixture.recipient;
    signers = fixture.signers;

    kettle = fixture.kettle;

    testErc721 = fixture.testErc721;
    testErc20 = fixture.testErc20;

    tokenId = fixture.tokenId;
    tokens = fixture.tokens;
    principal = fixture.principal;
  });

  let lienId: string | number | bigint;
  let lien: LienStruct;

  let loanOffer: LoanOfferStruct;
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
      maker: buyer,
      currency: testErc20,
      collection: testErc721,
      criteria: 0,
      identifier: tokenId,
      size: 1,
      amount: principal,
      withLoan: true,
      borrowAmount: principal
    }

    loanOffer = {
      lender: lender2,
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
      });

  for (var i=0; i<2; i++) {
    const delinquent = i === 1;

    describe(`[${delinquent ? 'DELINQUENT' : 'CURRENT'}] should purchase a listed asset in a lien with a loan offer`, () => {
      let borrowerBalanceBefore: bigint;
      let recipientBalanceBefore: bigint;
      let lenderBalanceBefore: bigint;
      let lender2BalanceBefore: bigint;
      let bidderBalanceBefore: bigint;
  
      beforeEach(async () => {
        if (delinquent) {
          await time.increase(MONTH_SECONDS + HALF_MONTH_SECONDS);
        }

        expect(await testErc721.ownerOf(tokenId)).to.eq(kettle);
        borrowerBalanceBefore = await testErc20.balanceOf(borrower);
        recipientBalanceBefore = await testErc20.balanceOf(recipient);
        lenderBalanceBefore = await testErc20.balanceOf(lender);
        lender2BalanceBefore = await testErc20.balanceOf(lender2);
        bidderBalanceBefore = await testErc20.balanceOf(buyer);
      });

      it("bid > amountOwed", async () => {
        const { amountOwed, principal, currentInterest, currentFee, pastFee, pastInterest } = await kettle.amountOwed(lien);
        expect(pastFee).to.equal(!delinquent ? 0n : currentFee);
        expect(pastInterest).to.equal(!delinquent ? 0n : currentInterest);

        bidOffer = {
          ...bidOffer,
          amount: amountOwed * 2n,
          borrowAmount: principal,
          identifier,
          criteria
        }

        const txn = await kettle.connect(borrower).sellInLienWithLoan(
          lienId,
          lien,
          loanOffer,
          bidOffer,
          proof,
          proof
        );

        // after checks
        expect(await testErc721.ownerOf(tokenId)).to.equal(kettle);

        expect(await testErc20.balanceOf(buyer)).to.equal(bidderBalanceBefore - (BigInt(bidOffer.amount) - BigInt(bidOffer.borrowAmount)));
        expect(await testErc20.balanceOf(borrower)).to.equal(borrowerBalanceBefore + BigInt(bidOffer.amount) - amountOwed);

        expect(await testErc20.balanceOf(recipient)).to.equal(recipientBalanceBefore + pastFee + currentFee);
        expect(await testErc20.balanceOf(lender)).to.equal(lenderBalanceBefore + currentInterest + pastInterest + principal);
        expect(await testErc20.balanceOf(lender2)).to.equal(lender2BalanceBefore - BigInt(bidOffer.borrowAmount));
      })

      it("amount owed > bid > principal + interest", async () => {
        const { amountOwed, principal, currentInterest, currentFee, pastFee, pastInterest } = await kettle.amountOwed(lien);
        expect(pastFee).to.equal(!delinquent ? 0n : currentFee);
        expect(pastInterest).to.equal(!delinquent ? 0n : currentInterest);
    
        bidOffer = {
          ...bidOffer,
          amount: principal + currentInterest + pastInterest + pastFee + (currentFee / 2n),
          borrowAmount: principal,
          identifier,
          criteria
        }

        const txn = await kettle.connect(borrower).sellInLienWithLoan(
          lienId,
          lien,
          loanOffer,
          bidOffer,
          proof,
          proof
        );

        // after checks
        expect(await testErc721.ownerOf(tokenId)).to.equal(kettle);

        expect(await testErc20.balanceOf(buyer)).to.equal(bidderBalanceBefore - (BigInt(bidOffer.amount) - BigInt(bidOffer.borrowAmount)));
        expect(await testErc20.balanceOf(borrower)).to.equal(borrowerBalanceBefore + BigInt(bidOffer.amount) - amountOwed);

        expect(await testErc20.balanceOf(recipient)).to.equal(recipientBalanceBefore + pastFee + currentFee);
        expect(await testErc20.balanceOf(lender)).to.equal(lenderBalanceBefore + currentInterest + pastInterest + principal);
        expect(await testErc20.balanceOf(lender2)).to.equal(lender2BalanceBefore - BigInt(bidOffer.borrowAmount));
      });

      it("amount owed > bid > principal", async () => {
        const { amountOwed, principal, currentInterest, currentFee, pastFee, pastInterest } = await kettle.amountOwed(lien);
        expect(pastFee).to.equal(!delinquent ? 0n : currentFee);
        expect(pastInterest).to.equal(!delinquent ? 0n : currentInterest);
    
        bidOffer = {
          ...bidOffer,
          amount: principal + (currentInterest / 2n) + pastInterest,
          borrowAmount: principal,
          identifier,
          criteria
        }

        const txn = await kettle.connect(borrower).sellInLienWithLoan(
          lienId,
          lien,
          loanOffer,
          bidOffer,
          proof,
          proof
        );

        // after checks
        expect(await testErc721.ownerOf(tokenId)).to.equal(kettle);

        expect(await testErc20.balanceOf(buyer)).to.equal(bidderBalanceBefore - (BigInt(bidOffer.amount) - BigInt(bidOffer.borrowAmount)));
        expect(await testErc20.balanceOf(borrower)).to.equal(borrowerBalanceBefore + BigInt(bidOffer.amount) - amountOwed);

        expect(await testErc20.balanceOf(recipient)).to.equal(recipientBalanceBefore + pastFee + currentFee);
        expect(await testErc20.balanceOf(lender)).to.equal(lenderBalanceBefore + currentInterest + pastInterest + principal);
        expect(await testErc20.balanceOf(lender2)).to.equal(lender2BalanceBefore - BigInt(bidOffer.borrowAmount));
      });

      it("amount owed > principal > bid", async () => {
        const { amountOwed, principal, currentInterest, currentFee, pastFee, pastInterest } = await kettle.amountOwed(lien);
        expect(pastFee).to.equal(!delinquent ? 0n : currentFee);
        expect(pastInterest).to.equal(!delinquent ? 0n : currentInterest);
    
        bidOffer = {
          ...bidOffer,
          amount: principal / 2n,
          borrowAmount: principal / 3n,
          identifier,
          criteria
        }

        const txn = await kettle.connect(borrower).sellInLienWithLoan(
          lienId,
          lien,
          loanOffer,
          bidOffer,
          proof,
          proof
        );

        // after checks
        expect(await testErc721.ownerOf(tokenId)).to.equal(kettle);

        expect(await testErc20.balanceOf(buyer)).to.equal(bidderBalanceBefore - (BigInt(bidOffer.amount) - BigInt(bidOffer.borrowAmount)));
        expect(await testErc20.balanceOf(borrower)).to.equal(borrowerBalanceBefore + BigInt(bidOffer.amount) - amountOwed);

        expect(await testErc20.balanceOf(recipient)).to.equal(recipientBalanceBefore + pastFee + currentFee);
        expect(await testErc20.balanceOf(lender)).to.equal(lenderBalanceBefore + currentInterest + pastInterest + principal);
        expect(await testErc20.balanceOf(lender2)).to.equal(lender2BalanceBefore - BigInt(bidOffer.borrowAmount));
      });

      it("amount owed > principal = bid amount = borrow amount", async () => {
        const { amountOwed, principal, currentInterest, currentFee, pastFee, pastInterest } = await kettle.amountOwed(lien);
        expect(pastFee).to.equal(!delinquent ? 0n : currentFee);
        expect(pastInterest).to.equal(!delinquent ? 0n : currentInterest);
        
        bidOffer = {
          ...bidOffer,
          amount: principal,
          borrowAmount: principal
        }

        const txn = await kettle.connect(borrower).sellInLienWithLoan(
          lienId,
          lien,
          loanOffer,
          bidOffer,
          proof,
          proof
        );

        // after checks
        expect(await testErc721.ownerOf(tokenId)).to.equal(kettle);

        expect(await testErc20.balanceOf(buyer)).to.equal(bidderBalanceBefore);
        expect(await testErc20.balanceOf(borrower)).to.equal(borrowerBalanceBefore + BigInt(bidOffer.amount) - amountOwed);

        expect(await testErc20.balanceOf(recipient)).to.equal(recipientBalanceBefore + pastFee + currentFee);
        expect(await testErc20.balanceOf(lender)).to.equal(lenderBalanceBefore + currentInterest + pastInterest + principal);
        expect(await testErc20.balanceOf(lender2)).to.equal(lender2BalanceBefore - BigInt(bidOffer.borrowAmount));
      });
    });
  }
});
  }

  it("should fail if caller is not borrower", async () => {
    await expect(kettle.connect(buyer).sellInLienWithLoan(
      lienId,
      lien,
      loanOffer,
      bidOffer,
      [],
      []
    )).to.be.revertedWithCustomError(kettle, "OnlyBorrower");  
  });

  it("should fail if offer is not bid", async () => {
    await expect(kettle.connect(borrower).sellInLienWithLoan(
      lienId,
      lien,
      loanOffer,
      { ...bidOffer, side: 1 },
      [],
      []
    )).to.be.revertedWithCustomError(kettle, "OfferNotBid");  
  });

  it("should fail if collections do not match (ask and lien)", async () => {
    await expect(kettle.connect(borrower).sellInLienWithLoan(
      lienId,
      lien,
      loanOffer,
      { ...bidOffer, collection: testErc20 },
      [],
      []
    )).to.be.revertedWithCustomError(kettle, "CollectionMismatch");    
  });

  it("should fail if collections do not match (loan offer and lien)", async () => {
    await expect(kettle.connect(borrower).sellInLienWithLoan(
      lienId,
      lien,
      { ...loanOffer, collection: testErc20 },
      bidOffer,
      [],
      []
    )).to.be.revertedWithCustomError(kettle, "CollectionMismatch");    
  });

  it("should fail if currencies do not match (ask and lien)", async () => {
    await expect(kettle.connect(borrower).sellInLienWithLoan(
      lienId,
      lien,
      loanOffer,
      { ...bidOffer, currency: testErc721 },
      [],
      []
    )).to.be.revertedWithCustomError(kettle, "CurrencyMismatch");    
  });

  it("should fail if currencies do not match (loan offer and lien)", async () => {
    await expect(kettle.connect(borrower).sellInLienWithLoan(
      lienId,
      lien,
      { ...loanOffer, currency: testErc721 },
      bidOffer,
      [],
      []
    )).to.be.revertedWithCustomError(kettle, "CurrencyMismatch");    
  });

  it("should fail if sizes do not match (ask and lien)", async () => {
    await expect(kettle.connect(borrower).sellInLienWithLoan(
      lienId,
      lien,
      loanOffer,
      { ...bidOffer, size: 2 },
      [],
      []
    )).to.be.revertedWithCustomError(kettle, "SizeMismatch");    
  });

  it("should fail if sizes do not match (loan offer and lien)", async () => {
    await expect(kettle.connect(borrower).sellInLienWithLoan(
      lienId,
      lien,
      { ...loanOffer, size: 2 },
      bidOffer,
      [],
      []
    )).to.be.revertedWithCustomError(kettle, "SizeMismatch");    
  });
});
