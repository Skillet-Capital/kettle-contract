import {
  time,
  loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer, parseUnits } from "ethers";

import { getFixture } from './setup';
import { extractMarketOrderLog } from './helpers/events';

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

  let seller: Signer;
  let buyer: Signer;
  let recipient: Signer;

  let kettle: Kettle;

  let principal: bigint;
  let tokenId1: number;
  let tokenId2: number;

  let testErc721: TestERC721;
  let testErc20: TestERC20;

  let bidOffer: MarketOfferStruct;
  let askOffer: MarketOfferStruct;

  beforeEach(async () => {
    const fixture = await getFixture();
    buyer = fixture.borrower;
    seller = fixture.lender;
    recipient = fixture.recipient;

    kettle = fixture.kettle;

    testErc721 = fixture.testErc721;
    testErc20 = fixture.testErc20;

    principal = fixture.principal;

    tokenId1 = 69;
    tokenId2 = 420;
  });

  it("should sell an asset into a bid", async () => {
    // mint token to seller
    await testErc721.mint(seller, tokenId1);
    await testErc721.connect(seller).setApprovalForAll(kettle, true);

    bidOffer = {
      side: 0,
      maker: buyer,
      currency: testErc20,
      collection: testErc721,
      tokenId: tokenId1,
      size: 1,
      amount: principal,
      withLoan: false,
      borrowAmount: 0
    }

    // before checks
    expect(await testErc721.ownerOf(tokenId1)).to.equal(seller);
    const sellerBalance_before = await testErc20.balanceOf(seller);
    const buyerBalance_before = await testErc20.balanceOf(buyer);

    const txn = await kettle.connect(seller).marketOrder(
      bidOffer,
      tokenId1,
      []
    );

    // after checks
    expect(await testErc721.ownerOf(tokenId1)).to.equal(buyer);
    expect(await testErc20.balanceOf(seller)).to.equal(sellerBalance_before + BigInt(bidOffer.amount));
    expect(await testErc20.balanceOf(buyer)).to.equal(buyerBalance_before - BigInt(bidOffer.amount));

    // log checks
    const { marketOrderLog } = await txn.wait().then(receipt => ({
      marketOrderLog: extractMarketOrderLog(receipt!)
    }));

    expect(marketOrderLog.buyer).to.equal(buyer);
    expect(marketOrderLog.seller).to.equal(seller);
    expect(marketOrderLog.currency).to.equal(testErc20);
    expect(marketOrderLog.collection).to.equal(testErc721);
    expect(marketOrderLog.tokenId).to.equal(tokenId1);
    expect(marketOrderLog.size).to.equal(1);
    expect(marketOrderLog.amount).to.equal(principal);
  });

  it("should fail to sell an asset into a bid requiring a loan", async () => {
    // mint token to seller
    await testErc721.mint(seller, tokenId1);
    await testErc721.connect(seller).setApprovalForAll(kettle, true);

    bidOffer = {
      side: 0,
      maker: buyer,
      currency: testErc20,
      collection: testErc721,
      tokenId: tokenId1,
      size: 1,
      amount: principal,
      withLoan: true,
      borrowAmount: 0
    }

    await expect(kettle.connect(seller).marketOrder(
      bidOffer,
      tokenId1,
      []
    )).to.be.revertedWithCustomError(kettle, "BidRequiresLoan");
  });

  it("should buy an asset with an ask", async () => {
    // mint token to seller
    await testErc721.mint(seller, tokenId1);
    await testErc721.connect(seller).setApprovalForAll(kettle, true);

    askOffer = {
      side: 1,
      maker: seller,
      currency: testErc20,
      collection: testErc721,
      tokenId: tokenId1,
      size: 1,
      amount: principal,
      withLoan: false,
      borrowAmount: 0
    }

    // before checks
    expect(await testErc721.ownerOf(tokenId1)).to.equal(seller);
    const sellerBalance_before = await testErc20.balanceOf(seller);
    const buyerBalance_before = await testErc20.balanceOf(buyer);

    const txn = await kettle.connect(buyer).marketOrder(
      askOffer,
      tokenId1,
      []
    );

    // after checks
    expect(await testErc721.ownerOf(tokenId1)).to.equal(buyer);
    expect(await testErc20.balanceOf(seller)).to.equal(sellerBalance_before + BigInt(bidOffer.amount));
    expect(await testErc20.balanceOf(buyer)).to.equal(buyerBalance_before - BigInt(bidOffer.amount));

    // log checks
    const { marketOrderLog } = await txn.wait().then(receipt => ({
      marketOrderLog: extractMarketOrderLog(receipt!)
    }));

    expect(marketOrderLog.buyer).to.equal(buyer);
    expect(marketOrderLog.seller).to.equal(seller);
    expect(marketOrderLog.currency).to.equal(testErc20);
    expect(marketOrderLog.collection).to.equal(testErc721);
    expect(marketOrderLog.tokenId).to.equal(tokenId1);
    expect(marketOrderLog.size).to.equal(1);
    expect(marketOrderLog.amount).to.equal(principal);
  });
});
