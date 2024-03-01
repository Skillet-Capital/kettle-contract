import { time } from "@nomicfoundation/hardhat-toolbox/network-helpers";

import { expect } from "chai";
import { Signer } from "ethers";

import { getFixture } from './setup';
import { extractMarketOrderLog } from './helpers/events';
import { randomBytes, generateMerkleRootForCollection, generateMerkleProofForToken } from './helpers/merkle';

import {
  TestERC20,
  TestERC721,
  Kettle
} from "../typechain-types";
import { LienStruct, LoanOfferStruct, LoanOfferTermsStruct, CollateralStruct, MarketOfferStruct, MarketOfferTermsStruct } from "../typechain-types/contracts/Kettle";

const DAY_SECONDS = 86400;
const MONTH_SECONDS = DAY_SECONDS * 365 / 12;

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
      let terms: MarketOfferTermsStruct;
      let collateral: CollateralStruct;

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
          identifier,
          size: 1
        }

        terms = {
          currency: testErc20,
          amount: principal,
          withLoan: false,
          borrowAmount: 0
        }
      });

      it("should sell an asset into a bid", async () => {
        bidOffer = {
          side: 0,
          maker: buyer,
          terms: terms,
          collateral: collateral,
          salt: randomBytes(),
          expiration: await time.latest() + DAY_SECONDS
        }

        // before checks
        expect(await testErc721.ownerOf(tokenId)).to.equal(seller);
        const sellerBalance_before = await testErc20.balanceOf(seller);
        const buyerBalance_before = await testErc20.balanceOf(buyer);

        const txn = await kettle.connect(seller).marketOrder(
          tokenId,
          bidOffer,
          proof
        );

        // after checks
        expect(await testErc721.ownerOf(tokenId)).to.equal(buyer);
        expect(await testErc20.balanceOf(seller)).to.equal(sellerBalance_before + BigInt(bidOffer.terms.amount));
        expect(await testErc20.balanceOf(buyer)).to.equal(buyerBalance_before - BigInt(bidOffer.terms.amount));

        // log checks
        const { marketOrderLog } = await txn.wait().then(receipt => ({
          marketOrderLog: extractMarketOrderLog(receipt!)
        }));

        expect(marketOrderLog.buyer).to.equal(buyer);
        expect(marketOrderLog.seller).to.equal(seller);
        expect(marketOrderLog.currency).to.equal(testErc20);
        expect(marketOrderLog.collection).to.equal(testErc721);
        expect(marketOrderLog.tokenId).to.equal(tokenId);
        expect(marketOrderLog.size).to.equal(1);
        expect(marketOrderLog.amount).to.equal(principal);
      });

      it("should fail to sell an asset into a bid requiring a loan", async () => {  
        terms.withLoan = true;

        bidOffer = {
          side: 0,
          maker: buyer,
          terms: terms,
          collateral: collateral,
          salt: randomBytes(),
          expiration: await time.latest() + DAY_SECONDS
        }
  
        await expect(kettle.connect(seller).marketOrder(
          tokenId,
          bidOffer,
          proof
        )).to.be.revertedWithCustomError(kettle, "BidRequiresLoan");
      });

      it("should buy an asset with an ask", async () => { 
        askOffer = {
          side: 1,
          maker: seller,
          terms: terms,
          collateral: collateral,
          salt: randomBytes(),
          expiration: await time.latest() + DAY_SECONDS
        }
  
        // before checks
        expect(await testErc721.ownerOf(tokenId)).to.equal(seller);
        const sellerBalance_before = await testErc20.balanceOf(seller);
        const buyerBalance_before = await testErc20.balanceOf(buyer);
  
        const txn = await kettle.connect(buyer).marketOrder(
          tokenId,
          askOffer,
          proof
        );
  
        // after checks
        expect(await testErc721.ownerOf(tokenId)).to.equal(buyer);
        expect(await testErc20.balanceOf(seller)).to.equal(sellerBalance_before + BigInt(bidOffer.terms.amount));
        expect(await testErc20.balanceOf(buyer)).to.equal(buyerBalance_before - BigInt(bidOffer.terms.amount));
  
        // log checks
        const { marketOrderLog } = await txn.wait().then(receipt => ({
          marketOrderLog: extractMarketOrderLog(receipt!)
        }));
  
        expect(marketOrderLog.buyer).to.equal(buyer);
        expect(marketOrderLog.seller).to.equal(seller);
        expect(marketOrderLog.currency).to.equal(testErc20);
        expect(marketOrderLog.collection).to.equal(testErc721);
        expect(marketOrderLog.tokenId).to.equal(tokenId);
        expect(marketOrderLog.size).to.equal(1);
        expect(marketOrderLog.amount).to.equal(principal);
      });
    })
  }
});
