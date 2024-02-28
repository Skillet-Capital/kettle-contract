import {
  time,
  loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer, parseUnits } from "ethers";

import { getFixture } from './setup';
import { extractBorrowLog, extractBuyWithLoanLog } from './helpers/events';

import {
  TestERC20,
  TestERC721,
  Kettle
} from "../typechain-types";
import { LienStruct, LoanOfferStruct, MarketOfferStruct } from "../typechain-types/contracts/Kettle";

const DAY_SECONDS = 86400;
const MONTH_SECONDS = DAY_SECONDS * 365 / 12;
const HALF_MONTH_SECONDS = MONTH_SECONDS / 2;

describe("Buy With Loan", function () {

  let owner: Signer;
  let borrower: Signer;
  let lender: Signer;
  let offerMaker: Signer;
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
    offerMaker = fixture.offerMaker;
    recipient = fixture.recipient;
    signers = fixture.signers;

    kettle = fixture.kettle;

    testErc721 = fixture.testErc721;

    principal = fixture.principal;
    testErc20 = fixture.testErc20;

    tokenId = 2;
    await testErc721.mint(offerMaker, tokenId);
    await testErc721.connect(offerMaker).setApprovalForAll(kettle, true);
  });

  let lienId: string | number | bigint;
  let lien: LienStruct;

  let loanOffer: LoanOfferStruct;
  let askOffer: MarketOfferStruct;

  beforeEach(async () => {
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

  it("should purchase an asset with an ask using a loan (amount < ask)", async () => {
    const borrowAmount = principal / 2n;

    askOffer = {
      side: 1,
      maker: offerMaker,
      currency: testErc20,
      collection: testErc721,
      tokenId: tokenId,
      size: 1,
      amount: principal * 3n / 2n,
      withLoan: false,
      borrowAmount: 0
    }

    // before checks
    expect(await testErc721.ownerOf(tokenId)).to.equal(offerMaker);
    const offerMakerBalance_before = await testErc20.balanceOf(offerMaker);
    const borrowerBalance_before = await testErc20.balanceOf(borrower);
    const lenderBalance_before = await testErc20.balanceOf(lender);

    const txn = await kettle.connect(borrower).buyWithLoan(
      loanOffer,
      askOffer,
      borrowAmount,
      tokenId,
      []   
    );

    // after checks
    expect(await testErc721.ownerOf(tokenId)).to.equal(kettle);
    expect(await testErc20.balanceOf(offerMaker)).to.equal(offerMakerBalance_before + BigInt(askOffer.amount));
    expect(await testErc20.balanceOf(borrower)).to.equal(borrowerBalance_before - (BigInt(askOffer.amount) - borrowAmount));
    expect(await testErc20.balanceOf(lender)).to.equal(lenderBalance_before - borrowAmount);

    // logging checks
    const { borrowLog, buyWithLoanLog } = await txn.wait().then(receipt => ({
      borrowLog: extractBorrowLog(receipt!),
      buyWithLoanLog: extractBuyWithLoanLog(receipt!)
    }));

    expect(borrowLog.lienId).to.equal(buyWithLoanLog.lienId);
    expect(borrowLog.lien.borrower).to.equal(buyWithLoanLog.buyer).to.equal(borrower);
    expect(borrowLog.lien.lender).to.equal(loanOffer.lender);
    expect(borrowLog.lien.collection).to.equal(buyWithLoanLog.collection);
    expect(borrowLog.lien.tokenId).to.equal(buyWithLoanLog.tokenId);
    expect(borrowLog.lien.principal).to.equal(buyWithLoanLog.borrowAmount);
    expect(buyWithLoanLog.seller).to.equal(askOffer.maker);

    expect(buyWithLoanLog.borrowAmount).to.equal(borrowLog.lien.principal).to.equal(borrowAmount);

  });

  it("should purchase an asset with an ask using a loan (amount > ask)", async () => {
    const borrowAmount = principal * 2n;

    askOffer = {
      side: 1,
      maker: offerMaker,
      currency: testErc20,
      collection: testErc721,
      tokenId: tokenId,
      size: 1,
      amount: principal,
      withLoan: false,
      borrowAmount: 0
    }

    // before checks
    const offerMakerBalance_before = await testErc20.balanceOf(offerMaker);
    const borrowerBalance_before = await testErc20.balanceOf(borrower);
    const lenderBalance_before = await testErc20.balanceOf(lender);

    const txn = await kettle.connect(borrower).buyWithLoan(
      loanOffer,
      askOffer,
      borrowAmount,
      tokenId,
      []
    );  

    // after checks
    expect(await testErc721.ownerOf(tokenId)).to.equal(kettle);
    expect(await testErc20.balanceOf(offerMaker)).to.equal(offerMakerBalance_before + BigInt(askOffer.amount));
    expect(await testErc20.balanceOf(borrower)).to.equal(borrowerBalance_before); // no change
    expect(await testErc20.balanceOf(lender)).to.equal(lenderBalance_before - principal);

    const { borrowLog, buyWithLoanLog } = await txn.wait().then(receipt => ({
      borrowLog: extractBorrowLog(receipt!),
      buyWithLoanLog: extractBuyWithLoanLog(receipt!)
    }));

    expect(borrowLog.lienId).to.equal(buyWithLoanLog.lienId);
    expect(borrowLog.lien.borrower).to.equal(buyWithLoanLog.buyer).to.equal(borrower);
    expect(borrowLog.lien.lender).to.equal(loanOffer.lender);
    expect(borrowLog.lien.collection).to.equal(buyWithLoanLog.collection);
    expect(borrowLog.lien.tokenId).to.equal(buyWithLoanLog.tokenId);
    expect(borrowLog.lien.principal).to.equal(buyWithLoanLog.borrowAmount);
    expect(buyWithLoanLog.seller).to.equal(askOffer.maker);

    expect(buyWithLoanLog.borrowAmount).to.equal(buyWithLoanLog.amount).to.equal(askOffer.amount).to.equal(principal);
  });

  it("should fail if side is not sell", async () => {
    const borrowAmount = principal;

    askOffer = {
      side: 0,
      maker: offerMaker,
      currency: testErc20,
      collection: testErc721,
      tokenId: tokenId,
      size: 1,
      amount: principal,
      withLoan: false,
      borrowAmount: 0
    }

    await expect(kettle.connect(borrower).buyWithLoan(
      loanOffer,
      askOffer,
      borrowAmount,
      tokenId,
      []
    )).to.be.revertedWithCustomError(kettle, "OfferNotAsk");  
  });

  it("should fail if collections do not match", async () => {
    const borrowAmount = principal;

    askOffer = {
      side: 1,
      maker: offerMaker,
      currency: testErc20,
      collection: testErc20, // use different address for mismatch
      tokenId: tokenId,
      size: 1,
      amount: principal,
      withLoan: false,
      borrowAmount: 0
    }

    await expect(kettle.connect(borrower).buyWithLoan(
      loanOffer,
      askOffer,
      borrowAmount,
      tokenId,
      []
    )).to.be.revertedWithCustomError(kettle, "CollectionMismatch");  
  });

  it("should fail if currencies do not match", async () => {
    const borrowAmount = principal;

    askOffer = {
      side: 1,
      maker: offerMaker,
      currency: testErc721, // use different address for mismatch
      collection: testErc721,
      tokenId: tokenId,
      size: 1,
      amount: principal,
      withLoan: false,
      borrowAmount: 0
    }

    await expect(kettle.connect(borrower).buyWithLoan(
      loanOffer,
      askOffer,
      borrowAmount,
      tokenId,
      []
    )).to.be.revertedWithCustomError(kettle, "CurrencyMismatch");  
  });

  it("should fail if sizes do not match", async () => {
    const borrowAmount = principal;

    askOffer = {
      side: 1,
      maker: offerMaker,
      currency: testErc20,
      collection: testErc721,
      tokenId: tokenId,
      size: 2,
      amount: principal,
      withLoan: false,
      borrowAmount: 0
    }

    await expect(kettle.connect(borrower).buyWithLoan(
      loanOffer,
      askOffer,
      borrowAmount,
      tokenId,
      []
    )).to.be.revertedWithCustomError(kettle, "SizeMismatch");  
  });
});
