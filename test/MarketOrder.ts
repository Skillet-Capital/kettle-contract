import { time } from "@nomicfoundation/hardhat-toolbox/network-helpers";

import { expect } from "chai";
import { Signer } from "ethers";

import { getFixture } from './setup';
import { signMarketOffer } from "./helpers/signatures";
import { extractMarketOrderLog } from './helpers/events';
import { randomBytes, generateMerkleRootForCollection, generateMerkleProofForToken } from './helpers/merkle';

import {
  TestERC20,
  TestERC721,
  Kettle
} from "../typechain-types";
import { LienStruct, LoanOfferStruct, LoanOfferTermsStruct, CollateralStruct, MarketOfferStruct, MarketOfferTermsStruct, FeeTermsStruct } from "../typechain-types/contracts/Kettle";

const DAY_SECONDS = 86400;
const MONTH_SECONDS = DAY_SECONDS * 365 / 12;

const BYTES_ZERO = "0x0000000000000000000000000000000000000000000000000000000000000000";

describe("Market Order", function () {

  let seller: Signer;
  let buyer: Signer;
  let recipient: Signer;

  let kettle: Kettle;

  let tokens: number[];
  let tokenId: number;
  let principal: bigint;

  let testErc721: TestERC721;
  let testErc20: TestERC20;

  let bidOffer: MarketOfferStruct;
  let askOffer: MarketOfferStruct;

  let sellerBalance_before: bigint;
  let buyerBalance_before: bigint;
  let recipientBalance_before: bigint;

  beforeEach(async () => {
    const fixture = await getFixture();
    buyer = fixture.offerMaker;
    seller = fixture.borrower;
    recipient = fixture.recipient;

    kettle = fixture.kettle;

    testErc721 = fixture.testErc721;
    testErc20 = fixture.testErc20;

    principal = fixture.principal;

    tokens = fixture.tokens;
    tokenId = fixture.tokenId;
  });

  for (const criteria of [0, 1]) {
    describe(`criteria: ${criteria == 0 ? "SIMPLE" : "PROOF"}`, () => {
      let collateral: CollateralStruct;
      let terms: MarketOfferTermsStruct;
      let fee: FeeTermsStruct;

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

        collateral = {
          collection: testErc721,
          criteria,
          itemType: 0,
          identifier,
          size: 1
        }

        terms = {
          currency: testErc20,
          amount: principal,
          withLoan: false,
          borrowAmount: 0,
          loanOfferHash: BYTES_ZERO
        }

        fee = {
          recipient: recipient,
          rate: 200
        }

        expect(await testErc721.ownerOf(tokenId)).to.equal(seller);
        buyerBalance_before = await testErc20.balanceOf(buyer);
        sellerBalance_before = await testErc20.balanceOf(seller);
        recipientBalance_before = await testErc20.balanceOf(recipient);
      });

      it("should sell an asset into a bid", async () => {
        bidOffer = {
          side: 0,
          maker: buyer,
          terms,
          collateral,
          fee,
          salt: randomBytes(),
          expiration: await time.latest() + DAY_SECONDS
        }

        const signature = await signMarketOffer(kettle, buyer, bidOffer);

        const txn = await kettle.connect(seller).marketOrder(
          tokenId,
          bidOffer,
          signature,
          proof
        );

        const { marketOrderLog } = await txn.wait().then(receipt => ({
          marketOrderLog: extractMarketOrderLog(receipt!)
        }));

        // after checks
        expect(await testErc721.ownerOf(tokenId)).to.equal(buyer);
        expect(await testErc20.balanceOf(seller)).to.equal(sellerBalance_before + BigInt(marketOrderLog.netAmount));
        expect(await testErc20.balanceOf(buyer)).to.equal(buyerBalance_before - BigInt(bidOffer.terms.amount));
        expect(await testErc20.balanceOf(recipient)).to.equal(recipientBalance_before + (BigInt(bidOffer.terms.amount) - marketOrderLog.netAmount));

        // log checks
        expect(marketOrderLog.buyer).to.equal(buyer);
        expect(marketOrderLog.seller).to.equal(seller);
        expect(marketOrderLog.currency).to.equal(testErc20);
        expect(marketOrderLog.collection).to.equal(testErc721);
        expect(marketOrderLog.tokenId).to.equal(tokenId);
        expect(marketOrderLog.size).to.equal(1);
        expect(marketOrderLog.amount).to.equal(principal);
        expect(marketOrderLog.netAmount).to.equal(principal * (BigInt(10000) - BigInt(bidOffer.fee.rate)) / BigInt(10000));
      });

      it("should fail to sell an asset into a bid requiring a loan", async () => {  
        terms.withLoan = true;

        bidOffer = {
          side: 0,
          maker: buyer,
          terms,
          collateral,
          fee,
          salt: randomBytes(),
          expiration: await time.latest() + DAY_SECONDS
        }

        const signature = await signMarketOffer(kettle, buyer, bidOffer);
  
        await expect(kettle.connect(seller).marketOrder(
          tokenId,
          bidOffer,
          signature,
          proof
        )).to.be.revertedWithCustomError(kettle, "BidRequiresLoan");
      });

      it("should buy an asset with an ask", async () => { 
        askOffer = {
          side: 1,
          maker: seller,
          terms,
          collateral,
          fee,
          salt: randomBytes(),
          expiration: await time.latest() + DAY_SECONDS
        }

        const signature = await signMarketOffer(kettle, seller, askOffer);
  
        // before checks
        expect(await testErc721.ownerOf(tokenId)).to.equal(seller);
        const sellerBalance_before = await testErc20.balanceOf(seller);
        const buyerBalance_before = await testErc20.balanceOf(buyer);
  
        const txn = await kettle.connect(buyer).marketOrder(
          tokenId,
          askOffer,
          signature,
          proof
        );

        const { marketOrderLog } = await txn.wait().then(receipt => ({
          marketOrderLog: extractMarketOrderLog(receipt!)
        }));
  
        // after checks
        expect(await testErc721.ownerOf(tokenId)).to.equal(buyer);
        expect(await testErc20.balanceOf(seller)).to.equal(sellerBalance_before + BigInt(marketOrderLog.netAmount));
        expect(await testErc20.balanceOf(buyer)).to.equal(buyerBalance_before - BigInt(askOffer.terms.amount));
        expect(await testErc20.balanceOf(recipient)).to.equal(recipientBalance_before + (BigInt(askOffer.terms.amount) - marketOrderLog.netAmount));
  
        // log checks  
        expect(marketOrderLog.buyer).to.equal(buyer);
        expect(marketOrderLog.seller).to.equal(seller);
        expect(marketOrderLog.currency).to.equal(testErc20);
        expect(marketOrderLog.collection).to.equal(testErc721);
        expect(marketOrderLog.tokenId).to.equal(tokenId);
        expect(marketOrderLog.size).to.equal(1);
        expect(marketOrderLog.amount).to.equal(principal);
        expect(marketOrderLog.netAmount).to.equal(principal * (BigInt(10000) - BigInt(bidOffer.fee.rate)) / BigInt(10000));
      });
    })
  }
});
