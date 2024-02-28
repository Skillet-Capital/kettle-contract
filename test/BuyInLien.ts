import { time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { Signer } from "ethers";

import { getFixture } from './setup';
import { extractBuyInLienLog, extractBorrowLog } from './helpers/events';
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

describe("Buy In Lien", function () {

  let owner: Signer;
  let borrower: Signer;
  let lender: Signer;
  let buyer: Signer;
  let recipient: Signer;

  let signers: Signer[];
  let kettle: Kettle;

  let testErc721: TestERC721;
  let testErc20: TestERC20;

  let tokens: number[];
  let tokenId: number;
  let principal: bigint;

  let lienId: string | number | bigint;
  let lien: LienStruct;

  let loanOffer: LoanOfferStruct;
  let askOffer: MarketOfferStruct;

  let buyerBalance_before: bigint;
  let borrowerBalance_before: bigint;
  let lenderBalance_before: bigint;
  let recipientBalance_before: bigint;

  beforeEach(async () => {
    const fixture = await getFixture();
    owner = fixture.owner;
    borrower = fixture.borrower;
    lender = fixture.lender;
    buyer = fixture.offerMaker;
    recipient = fixture.recipient;
    signers = fixture.signers;

    kettle = fixture.kettle;

    testErc721 = fixture.testErc721;
    testErc20 = fixture.testErc20;

    tokens = fixture.tokens;
    tokenId = fixture.tokenId;
    principal = fixture.principal;
  });

  beforeEach(async () => {
    loanOffer = {
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

    const txn = await kettle.connect(borrower).borrow(loanOffer, principal, tokenId, borrower, []);
      ({ lienId, lien } = await txn.wait().then(receipt => extractBorrowLog(receipt!))
    );

    askOffer = {
      side: 1,
      maker: borrower,
      currency: testErc20,
      collection: testErc721,
      criteria: 0,
      identifier: tokenId,
      size: 1,
      amount: principal * 3n / 2n,
      withLoan: false,
      borrowAmount: 0
    }

    buyerBalance_before = await testErc20.balanceOf(buyer);
    borrowerBalance_before = await testErc20.balanceOf(borrower);
    lenderBalance_before = await testErc20.balanceOf(lender);
    recipientBalance_before = await testErc20.balanceOf(recipient);
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

      it("should purchase a listed asset in a lien (current lien)", async () => {
        const { amountOwed, principal: _principal, currentInterest, currentFee, pastInterest, pastFee } = await kettle.amountOwed(lien);
    
        // before checks
        expect(await testErc721.ownerOf(tokenId)).to.equal(kettle);
        const txn = await kettle.connect(buyer).buyInLien(
          lienId,
          lien,
          { ...askOffer, identifier, criteria },
          proof
        );
    
        // after checks
        expect(await testErc721.ownerOf(tokenId)).to.equal(buyer);
        expect(await testErc20.balanceOf(buyer)).to.equal(buyerBalance_before - BigInt(askOffer.amount));
        expect(await testErc20.balanceOf(borrower)).to.equal(borrowerBalance_before + (BigInt(askOffer.amount) - amountOwed));
        expect(await testErc20.balanceOf(lender)).to.equal(lenderBalance_before + pastInterest + currentInterest + _principal);
        expect(await testErc20.balanceOf(recipient)).to.equal(recipientBalance_before + pastFee + currentFee);
    
        const buyInLienLog = await txn.wait().then(receipt => extractBuyInLienLog(receipt!));
    
        expect(buyInLienLog.lienId).to.equal(lienId);
        expect(buyInLienLog.buyer).to.equal(buyer);
        expect(buyInLienLog.seller).to.equal(borrower).to.equal(askOffer.maker);
        expect(buyInLienLog.currency).to.equal(lien.currency);
        expect(buyInLienLog.collection).to.equal(lien.collection);
        expect(buyInLienLog.tokenId).to.equal(lien.tokenId);
        expect(buyInLienLog.size).to.equal(lien.size);
        expect(buyInLienLog.askAmount).to.equal(askOffer.amount);
    
        expect(buyInLienLog.amountOwed).to.equal(amountOwed);
        expect(buyInLienLog.principal).to.equal(_principal);
        expect(buyInLienLog.currentInterest).to.equal(currentInterest);
        expect(buyInLienLog.currentFee).to.equal(currentFee);
        expect(buyInLienLog.pastInterest).to.equal(pastInterest);
        expect(buyInLienLog.pastFee).to.equal(pastFee);
    
      });
  
      it("should purchase a listed asset in a lien (delinquent lien)", async () => {
        await time.increaseTo(BigInt(lien.startTime) + (BigInt(lien.period) * 3n / 2n));
    
        const { amountOwed, principal: _principal, currentInterest, currentFee, pastInterest, pastFee } = await kettle.amountOwed(lien);
    
        // before checks
        expect(await testErc721.ownerOf(tokenId)).to.equal(kettle);
        const txn = await kettle.connect(buyer).buyInLien(
          lienId,
          lien,
          { ...askOffer, identifier, criteria },
          proof
        );
    
        // after checks
        expect(await testErc721.ownerOf(tokenId)).to.equal(buyer);
        expect(await testErc20.balanceOf(buyer)).to.equal(buyerBalance_before - BigInt(askOffer.amount));
        expect(await testErc20.balanceOf(borrower)).to.equal(borrowerBalance_before + (BigInt(askOffer.amount) - amountOwed));
        expect(await testErc20.balanceOf(lender)).to.equal(lenderBalance_before + pastInterest + currentInterest + _principal);
        expect(await testErc20.balanceOf(recipient)).to.equal(recipientBalance_before + pastFee + currentFee);
    
        const buyInLienLog = await txn.wait().then(receipt => extractBuyInLienLog(receipt!));
    
        expect(buyInLienLog.lienId).to.equal(lienId);
        expect(buyInLienLog.buyer).to.equal(buyer);
        expect(buyInLienLog.seller).to.equal(borrower).to.equal(askOffer.maker);
        expect(buyInLienLog.currency).to.equal(lien.currency);
        expect(buyInLienLog.collection).to.equal(lien.collection);
        expect(buyInLienLog.tokenId).to.equal(lien.tokenId);
        expect(buyInLienLog.size).to.equal(lien.size);
        expect(buyInLienLog.askAmount).to.equal(askOffer.amount);
    
        expect(buyInLienLog.amountOwed).to.equal(amountOwed);
        expect(buyInLienLog.principal).to.equal(_principal);
        expect(buyInLienLog.currentInterest).to.equal(currentInterest);
        expect(buyInLienLog.currentFee).to.equal(currentFee);
        expect(buyInLienLog.pastInterest).to.equal(pastInterest);
        expect(buyInLienLog.pastFee).to.equal(pastFee);
    
      });
    });
  }

  it("should fail if lien is defaulted", async () => {
    await time.increaseTo(BigInt(lien.startTime) + (BigInt(lien.period) * 3n));

    await expect(kettle.connect(buyer).buyInLien(
      lienId,
      lien,
      askOffer,
      []
    )).to.be.revertedWithCustomError(kettle, "LienDefaulted");  
  });

  it("should fail if token id does not match identifier", async () => {
    await expect(kettle.connect(buyer).buyInLien(
      lienId,
      lien,
      { ...askOffer, identifier: tokenId + 1 },
      []
    )).to.be.revertedWithCustomError(kettle, "InvalidCriteria");
  });

  it("should fail if criteria expected and does not match", async () => {
    await expect(kettle.connect(buyer).buyInLien(
      lienId,
      lien,
      { ...askOffer, criteria: 1 },
      [
        randomBytes()
      ]
    )).to.be.revertedWithCustomError(kettle, "InvalidCriteria");
  });

  it("should fail if borrower is not offer maker", async () => {
    await expect(kettle.connect(buyer).buyInLien(
      lienId,
      lien,
      { ...askOffer, maker: buyer },
      []
    )).to.be.revertedWithCustomError(kettle, "MakerIsNotBorrower");  
  });

  it("should fail if offer is not ask", async () => {
    await expect(kettle.connect(buyer).buyInLien(
      lienId,
      lien,
      { ...askOffer, side: 0 },
      []
    )).to.be.revertedWithCustomError(kettle, "OfferNotAsk");  
  });

  it("should fail if collections do not match", async () => {
    await expect(kettle.connect(borrower).buyInLien(
      lienId,
      lien,
      { ...askOffer, collection: testErc20 },
      []
    )).to.be.revertedWithCustomError(kettle, "CollectionMismatch");  
  });

  it("should fail if currencies do not match", async () => {
    await expect(kettle.connect(borrower).buyInLien(
      lienId,
      lien,
      { ...askOffer, currency: testErc721 },
      []
    )).to.be.revertedWithCustomError(kettle, "CurrencyMismatch");  
  });

  it("should fail if sizes do not match", async () => {
    await expect(kettle.connect(borrower).buyInLien(
      lienId,
      lien,
      { ...askOffer, size: 2 },
      []
    )).to.be.revertedWithCustomError(kettle, "SizeMismatch");  
  });

  it("should fail if ask amount does not cover debt", async () => {
    await expect(kettle.connect(borrower).buyInLien(
      lienId,
      lien,
      { ...askOffer, amount: principal },
      []
    )).to.be.revertedWithCustomError(kettle, "InsufficientAskAmount");  
  });
});
