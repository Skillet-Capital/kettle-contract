import {
  time,
  loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer, parseUnits } from "ethers";

import { getFixture } from './setup';
import { extractBorrowLog, extractSellWithLoanLog } from './helpers/events';

import {
  TestERC20,
  TestERC721,
  Kettle
} from "../typechain-types";
import { LienStruct, LoanOfferStruct, MarketOfferStruct } from "../typechain-types/contracts/Kettle";

const DAY_SECONDS = 86400;
const MONTH_SECONDS = DAY_SECONDS * 365 / 12;
const HALF_MONTH_SECONDS = MONTH_SECONDS / 2;

describe("Buy In Lien With Loan", function () {

  let lender: Signer;
  let seller: Signer;
  let buyer: Signer;
  let recipient: Signer;

  let kettle: Kettle;

  let principal: bigint;
  let tokenId: number;

  let testErc721: TestERC721;
  let testErc20: TestERC20;

  beforeEach(async () => {
    const fixture = await getFixture();
    lender = fixture.lender;
    seller = fixture.borrower;
    buyer = fixture.offerMaker;
    recipient = fixture.recipient;

    kettle = fixture.kettle;

    principal = fixture.principal;
    tokenId = fixture.tokenId;

    testErc721 = fixture.testErc721;
    testErc20 = fixture.testErc20;
  });

  let lienId: string | number | bigint;
  let lien: LienStruct;

  let loanOffer: LoanOfferStruct;
  let bidOffer: MarketOfferStruct;

  beforeEach(() => {
    bidOffer = {
      side: 0,
      maker: buyer,
      currency: testErc20,
      collection: testErc721,
      tokenId: tokenId,
      size: 1,
      amount: principal,
      withLoan: true,
      borrowAmount: principal / 2n
    }

    loanOffer = {
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
  })

  it("should sell an asset into a bid using a loan", async () => {

    // before checks
    expect(await testErc721.ownerOf(tokenId)).to.equal(seller);
    const sellerBalance_before = await testErc20.balanceOf(seller);
    const buyerBalance_before = await testErc20.balanceOf(buyer);
    const lenderBalance_before = await testErc20.balanceOf(lender);

    const txn = await kettle.connect(seller).sellWithLoan(
      loanOffer,
      bidOffer,
      tokenId,
      []
    );

    // after checks
    expect(await testErc721.ownerOf(tokenId)).to.equal(kettle);

    expect(await testErc20.balanceOf(seller)).to.equal(sellerBalance_before + BigInt(bidOffer.amount));
    expect(await testErc20.balanceOf(buyer)).to.equal(buyerBalance_before - (BigInt(bidOffer.amount) - BigInt(bidOffer.borrowAmount)));
    expect(await testErc20.balanceOf(lender)).to.equal(lenderBalance_before - BigInt(bidOffer.borrowAmount));

    // log checks
    const { borrowLog, sellWithLoanLog } = await txn.wait().then(receipt => ({
      borrowLog: extractBorrowLog(receipt!),
      sellWithLoanLog: extractSellWithLoanLog(receipt!)
    }));

    expect(borrowLog.lienId).to.equal(sellWithLoanLog.lienId);
    expect(borrowLog.lien.borrower).to.equal(sellWithLoanLog.buyer).to.equal(bidOffer.maker).to.equal(buyer);
    
    expect(sellWithLoanLog.seller).to.equal(seller);
    expect(borrowLog.lien.lender).to.equal(lender);

    expect(borrowLog.lien.currency).to.equal(loanOffer.currency);
    expect(borrowLog.lien.collection).to.equal(loanOffer.collection);
    expect(borrowLog.lien.tokenId).to.equal(loanOffer.identifier).to.equal(tokenId);
    expect(borrowLog.lien.size).to.equal(loanOffer.size);
    expect(borrowLog.lien.principal).to.equal(bidOffer.borrowAmount);
    expect(sellWithLoanLog.amount).to.equal(bidOffer.amount).to.equal(principal);
  })

  describe("fail checks", () => {
    it("should fail if offer is not bid", async () => {
      await expect(kettle.connect(seller).sellWithLoan(
        loanOffer,
        { ...bidOffer, side: 1 },
        tokenId,
        []
      )).to.be.revertedWithCustomError(kettle, "OfferNotBid");
    });

    it("should fail if bid not with loan", async () => {
      await expect(kettle.connect(seller).sellWithLoan(
        loanOffer,
        { ...bidOffer, withLoan: false },
        tokenId,
        []
      )).to.be.revertedWithCustomError(kettle, "BidNotWithLoan");
    });

    it("should fail if bid amount less than borrow amount", async () => {
      await expect(kettle.connect(seller).sellWithLoan(
        loanOffer,
        { ...bidOffer, borrowAmount: principal * 2n },
        tokenId,
        []
      )).to.be.revertedWithCustomError(kettle, "BidCannotBorrow");
    });

    it("should fail if collections do not match", async () => {
      await expect(kettle.connect(seller).sellWithLoan(
        loanOffer,
        { ...bidOffer, collection: testErc20 },
        tokenId,
        []
      )).to.be.revertedWithCustomError(kettle, "CollectionMismatch");
    });

    it("should fail if currencies do not match", async () => {
      await expect(kettle.connect(seller).sellWithLoan(
        loanOffer,
        { ...bidOffer, currency: testErc721 },
        tokenId,
        []
      )).to.be.revertedWithCustomError(kettle, "CurrencyMismatch");
    });

    it("should fail if sizes do not match", async () => {
      await expect(kettle.connect(seller).sellWithLoan(
        loanOffer,
        { ...bidOffer, size: 2 },
        tokenId,
        []
      )).to.be.revertedWithCustomError(kettle, "SizeMismatch");
    });
  })
});
