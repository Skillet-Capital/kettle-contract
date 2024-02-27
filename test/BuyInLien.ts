import {
  time,
  loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer, parseUnits } from "ethers";

import { getFixture } from './setup';
import { extractBuyInLienLog, extractBorrowLog } from './helpers/events';

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

  let tokenId: number;
  let testErc721: TestERC721;

  let principal: bigint;
  let testErc20: TestERC20;


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

    tokenId = fixture.tokenId;
    principal = fixture.principal;
    testErc20 = fixture.testErc20;
  });

  let lienId: string | number | bigint;
  let lien: LienStruct;

  let askOffer: MarketOfferStruct;

  beforeEach(async () => {
    const offer = {
      lender: lender,
      recipient: recipient,
      currency: testErc20,
      collection: testErc721,
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
  })

  it("should purchase a listed asset in a lien (current lien)", async () => {
    askOffer = {
      side: 1,
      maker: borrower,
      currency: testErc20,
      collection: testErc721,
      tokenId: tokenId,
      size: 1,
      amount: principal * 3n / 2n,
      withLoan: false,
      borrowAmount: 0
    }

    const { amountOwed, principal: _principal, currentInterest, currentFee, pastInterest, pastFee } = await kettle.amountOwed(lien);
    expect(_principal).to.equal(principal);
    expect(pastInterest).to.equal(0n);
    expect(pastFee).to.equal(0n);
    expect(currentInterest).to.equal(83333333n);
    expect(currentFee).to.equal(16666666n)
    expect(amountOwed).to.equal(principal + currentInterest + currentFee).to.equal(10099999999n);

    // before checks
    expect(await testErc721.ownerOf(tokenId)).to.equal(kettle);
    const buyerBalance_before = await testErc20.balanceOf(buyer);
    const borrowerBalance_before = await testErc20.balanceOf(borrower);
    const lenderBalance_before = await testErc20.balanceOf(lender);
    const recipientBalance_before = await testErc20.balanceOf(recipient);

    const txn = await kettle.connect(buyer).buyInLien(
      lienId,
      lien,
      askOffer
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

    askOffer = {
      side: 1,
      maker: borrower,
      currency: testErc20,
      collection: testErc721,
      tokenId: tokenId,
      size: 1,
      amount: principal * 3n / 2n,
      withLoan: false,
      borrowAmount: 0
    }

    const { amountOwed, principal: _principal, currentInterest, currentFee, pastInterest, pastFee } = await kettle.amountOwed(lien);
    expect(_principal).to.equal(principal);
    expect(pastInterest).to.equal(83333333n);
    expect(pastFee).to.equal(16666666n);
    expect(currentInterest).to.equal(83333333n);
    expect(currentFee).to.equal(16666666n)
    expect(amountOwed).to.equal(principal + currentInterest + currentFee + pastInterest + pastFee).to.equal(10199999998);

    // before checks
    expect(await testErc721.ownerOf(tokenId)).to.equal(kettle);
    const buyerBalance_before = await testErc20.balanceOf(buyer);
    const borrowerBalance_before = await testErc20.balanceOf(borrower);
    const lenderBalance_before = await testErc20.balanceOf(lender);
    const recipientBalance_before = await testErc20.balanceOf(recipient);

    const txn = await kettle.connect(buyer).buyInLien(
      lienId,
      lien,
      askOffer
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

  it("should fail if lien is defaulted", async () => {
    await time.increaseTo(BigInt(lien.startTime) + (BigInt(lien.period) * 3n));

    askOffer = {
      side: 1,
      maker: lender,
      currency: testErc20,
      collection: testErc721,
      tokenId: tokenId,
      size: 1,
      amount: principal * 3n / 2n,
      withLoan: false,
      borrowAmount: 0
    }

    await expect(kettle.connect(buyer).buyInLien(
      lienId,
      lien,
      askOffer
    )).to.be.revertedWithCustomError(kettle, "LienDefaulted");  
  });

  it("should fail if borrower is not offer maker", async () => {

    askOffer = {
      side: 1,
      maker: lender,
      currency: testErc20,
      collection: testErc721,
      tokenId: tokenId,
      size: 1,
      amount: principal * 3n / 2n,
      withLoan: false,
      borrowAmount: 0
    }

    await expect(kettle.connect(buyer).buyInLien(
      lienId,
      lien,
      askOffer
    )).to.be.revertedWithCustomError(kettle, "MakerIsNotBorrower");  
  });

  it("should fail if offer is not ask", async () => {

    askOffer = {
      side: 0,
      maker: borrower,
      currency: testErc20,
      collection: testErc721,
      tokenId: tokenId,
      size: 1,
      amount: principal,
      withLoan: false,
      borrowAmount: 0
    }

    await expect(kettle.connect(buyer).buyInLien(
      lienId,
      lien,
      askOffer
    )).to.be.revertedWithCustomError(kettle, "OfferNotAsk");  
  });

  it("should fail if collections do not match", async () => {
    askOffer = {
      side: 1,
      maker: borrower,
      currency: testErc20,
      collection: testErc20, // use different address for mismatch
      tokenId: tokenId,
      size: 1,
      amount: principal,
      withLoan: false,
      borrowAmount: 0
    }

    await expect(kettle.connect(borrower).buyInLien(
      lienId,
      lien,
      askOffer
    )).to.be.revertedWithCustomError(kettle, "CollectionMismatch");  
  });

  it("should fail if currencies do not match", async () => {
    askOffer = {
      side: 1,
      maker: borrower,
      currency: testErc721, // use different address for mismatch
      collection: testErc721,
      tokenId: tokenId,
      size: 1,
      amount: principal,
      withLoan: false,
      borrowAmount: 0
    }

    await expect(kettle.connect(borrower).buyInLien(
      lienId,
      lien,
      askOffer
    )).to.be.revertedWithCustomError(kettle, "CurrencyMismatch");  
  });

  it("should fail if sizes do not match", async () => {
    askOffer = {
      side: 1,
      maker: borrower,
      currency: testErc20,
      collection: testErc721,
      tokenId: tokenId,
      size: 2,
      amount: principal,
      withLoan: false,
      borrowAmount: 0
    }

    await expect(kettle.connect(borrower).buyInLien(
      lienId,
      lien,
      askOffer
    )).to.be.revertedWithCustomError(kettle, "SizeMismatch");  
  });

  it("should fail if ask amount does not cover debt", async () => {
    askOffer = {
      side: 1,
      maker: borrower,
      currency: testErc20,
      collection: testErc721,
      tokenId: tokenId,
      size: 1,
      amount: principal,
      withLoan: false,
      borrowAmount: 0
    }

    await expect(kettle.connect(borrower).buyInLien(
      lienId,
      lien,
      askOffer
    )).to.be.revertedWithCustomError(kettle, "InsufficientAskAmount");  
  });
});