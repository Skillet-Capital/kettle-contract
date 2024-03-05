import {
  time,
  loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import { ethers } from "hardhat";
import { ContractTransactionResponse, Signer, parseUnits } from "ethers";

import { getFixture } from './setup';
import { signLoanOffer, signMarketOffer } from "./helpers/signatures";
import { extractBorrowLog, extractSellWithLoanLog } from './helpers/events';
import { randomBytes, generateMerkleRootForCollection, generateMerkleProofForToken } from './helpers/merkle';

import {
  TestERC20,
  TestERC721,
  Kettle
} from "../typechain-types";
import { LienStruct, LoanOfferStruct, LoanOfferTermsStruct, CollateralStruct, MarketOfferStruct, MarketOfferTermsStruct, FeeTermsStruct } from "../typechain-types/contracts/Kettle";

const DAY_SECONDS = 86400;
const MONTH_SECONDS = DAY_SECONDS * 365 / 12;
const HALF_MONTH_SECONDS = MONTH_SECONDS / 2;

describe("Sell With Loan", function () {

  let seller: Signer;
  let buyer: Signer;

  let lender: Signer;
  let recipient: Signer;
  let marketFeeRecipient: Signer;

  let kettle: Kettle;

  let principal: bigint;
  let tokens: number[];
  let tokenId: number;

  let testErc721: TestERC721;
  let testErc20: TestERC20;

  beforeEach(async () => {
    const fixture = await getFixture();

    seller = fixture.borrower;
    buyer = fixture.offerMaker;

    lender = fixture.lender;
    recipient = fixture.recipient;
    marketFeeRecipient = fixture.marketFeeRecipient;

    kettle = fixture.kettle;

    principal = fixture.principal;
    tokenId = fixture.tokenId;
    tokens = fixture.tokens;

    testErc721 = fixture.testErc721;
    testErc20 = fixture.testErc20;
  });

  let txn: ContractTransactionResponse;

  let lienId: string | number | bigint;
  let lien: LienStruct;

  let loanOffer: LoanOfferStruct;
  let bidOffer: MarketOfferStruct;

  let loanOfferSignature: string;
  let bidOfferSignature: string;

  let sellerBalance_before: bigint;
  let buyerBalance_before: bigint;
  
  let lenderBalance_before: bigint;  
  let marketFeeRecipientBalance_before: bigint;

  beforeEach(async () => {

    const loanOfferTerms: LoanOfferTermsStruct = {
      currency: testErc20,
      totalAmount: principal,
      maxAmount: principal,
      minAmount: 0,
      rate: "1000",
      defaultRate: "200",
      period: MONTH_SECONDS,
      gracePeriod: MONTH_SECONDS,
      installments: 12
    }

    const loanOfferFee: FeeTermsStruct = {
      recipient: recipient,
      rate: "200"
    }

    const collateral: CollateralStruct = {
      collection: testErc721,
      criteria: 0,
      identifier: tokenId,
      size: 1
    }

    loanOffer = {
      lender: lender,
      terms: loanOfferTerms,
      fee: loanOfferFee,
      collateral: { ...collateral},
      salt: randomBytes(),
      expiration: await time.latest() + DAY_SECONDS
    }

    const loanOfferHash = await kettle.hashLoanOffer(loanOffer);

    const bidOfferTerms: MarketOfferTermsStruct = {
      currency: testErc20,
      amount: principal,
      withLoan: true,
      borrowAmount: principal / 2n,
      loanOfferHash
    }

    const bidOfferFeeTerms: FeeTermsStruct = {
      recipient: marketFeeRecipient,
      rate: 200
    }

    bidOffer = {
      side: 0,
      maker: buyer,
      terms: bidOfferTerms,
      fee: bidOfferFeeTerms,
      collateral: { ...collateral },
      salt: randomBytes(),
      expiration: await time.latest() + DAY_SECONDS
    }

    loanOfferSignature = await signLoanOffer(kettle, lender, loanOffer);
    bidOfferSignature = await signMarketOffer(kettle, buyer, bidOffer);

    sellerBalance_before = await testErc20.balanceOf(seller);
    buyerBalance_before = await testErc20.balanceOf(buyer);

    lenderBalance_before = await testErc20.balanceOf(lender);
    marketFeeRecipientBalance_before = await testErc20.balanceOf(marketFeeRecipient);
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

        loanOffer.collateral.criteria = criteria;
        loanOffer.collateral.identifier = identifier;

        bidOffer.collateral.criteria = criteria;
        bidOffer.collateral.identifier = identifier;

        bidOffer.terms.loanOfferHash = await kettle.hashLoanOffer(loanOffer);
        bidOfferSignature = await signMarketOffer(kettle, buyer, bidOffer);
        loanOfferSignature = await signLoanOffer(kettle, lender, loanOffer);
      });

      afterEach(async () => {
        const marketFeeAmount = BigInt(bidOffer.terms.amount) * BigInt(bidOffer.fee.rate) / 10_000n;
        const netSellAmount = BigInt(bidOffer.terms.amount) - marketFeeAmount;
        const netPurchaseAmount = BigInt(bidOffer.terms.amount) - BigInt(bidOffer.terms.borrowAmount);

        expect(await testErc721.ownerOf(tokenId)).to.equal(kettle);
        expect(await testErc20.balanceOf(seller)).to.equal(sellerBalance_before + netSellAmount);
        expect(await testErc20.balanceOf(buyer)).to.equal(buyerBalance_before - netPurchaseAmount);
        expect(await testErc20.balanceOf(lender)).to.equal(lenderBalance_before - BigInt(bidOffer.terms.borrowAmount));
        expect(await testErc20.balanceOf(marketFeeRecipient)).to.equal(marketFeeRecipientBalance_before + marketFeeAmount);

        // log checks
        const { borrowLog, sellWithLoanLog } = await txn.wait().then(receipt => ({
          borrowLog: extractBorrowLog(receipt!),
          sellWithLoanLog: extractSellWithLoanLog(receipt!)
        }));
    
        expect(borrowLog.lienId).to.equal(sellWithLoanLog.lienId);
        expect(borrowLog.lien.borrower).to.equal(sellWithLoanLog.buyer).to.equal(bidOffer.maker).to.equal(buyer);
        
        expect(sellWithLoanLog.seller).to.equal(seller);
        expect(borrowLog.lien.lender).to.equal(lender);
    
        expect(borrowLog.lien.currency).to.equal(sellWithLoanLog.currency).to.equal(loanOffer.terms.currency);
        expect(borrowLog.lien.collection).to.equal(sellWithLoanLog.collection).to.equal(loanOffer.collateral.collection);
        expect(borrowLog.lien.tokenId).to.equal(sellWithLoanLog.tokenId).to.equal(tokenId);
        expect(borrowLog.lien.size).to.equal(sellWithLoanLog.size).to.equal(loanOffer.collateral.size);
        expect(borrowLog.lien.principal).to.equal(sellWithLoanLog.borrowAmount).to.equal(bidOffer.terms.borrowAmount);
        expect(sellWithLoanLog.amount).to.equal(sellWithLoanLog.amount).to.equal(bidOffer.terms.amount).to.equal(principal);
        expect(sellWithLoanLog.netAmount).to.equal(netSellAmount);
      })

      it("should sell an asset into a bid using a loan", async () => {    
        txn = await kettle.connect(seller).sellWithLoan(
          tokenId,
          loanOffer,
          bidOffer,
          loanOfferSignature,
          bidOfferSignature,
          proof,
          proof
        );
      })
    });
  }

  describe("fail checks", () => {
    it("should fail if offer is not bid", async () => {
      bidOffer.side = 1;
      bidOfferSignature = await signMarketOffer(kettle, buyer, bidOffer);
      await expect(kettle.connect(seller).sellWithLoan(
        tokenId,
        loanOffer,
        bidOffer,
        loanOfferSignature,
        bidOfferSignature,
        [],
        []
      )).to.be.revertedWithCustomError(kettle, "OfferNotBid");
    });

    it("should fail if bid not with loan", async () => {
      bidOffer.terms.withLoan = false;
      bidOfferSignature = await signMarketOffer(kettle, buyer, bidOffer);
      await expect(kettle.connect(seller).sellWithLoan(
        tokenId,
        loanOffer,
        bidOffer,
        loanOfferSignature,
        bidOfferSignature,
        [],
        []
      )).to.be.revertedWithCustomError(kettle, "BidNotWithLoan");
    });

    it("should fail if bid amount less than borrow amount", async () => {
      bidOffer.terms.borrowAmount = principal * 2n;
      bidOfferSignature = await signMarketOffer(kettle, buyer, bidOffer);
      await expect(kettle.connect(seller).sellWithLoan(
        tokenId,
        loanOffer,
        bidOffer,
        loanOfferSignature,
        bidOfferSignature,
        [],
        []
      )).to.be.revertedWithCustomError(kettle, "BidCannotBorrow");
    });

    it("should fail if loan offer hash does not match loan offer", async () => {
      bidOffer.terms.loanOfferHash = randomBytes();
      bidOfferSignature = await signMarketOffer(kettle, buyer, bidOffer);
      await expect(kettle.connect(seller).sellWithLoan(
        tokenId,
        loanOffer,
        bidOffer,
        loanOfferSignature,
        bidOfferSignature,
        [],
        []
      )).to.be.revertedWithCustomError(kettle, "BidCannotBorrow");
    })

    it("should fail if collections do not match", async () => {
      bidOffer.collateral.collection = testErc20;
      bidOfferSignature = await signMarketOffer(kettle, buyer, bidOffer);
      await expect(kettle.connect(seller).sellWithLoan(
        tokenId,
        loanOffer,
        bidOffer,
        loanOfferSignature,
        bidOfferSignature,
        [],
        []
      )).to.be.revertedWithCustomError(kettle, "CollectionMismatch");
    });

    it("should fail if currencies do not match", async () => {
      bidOffer.terms.currency = testErc721;
      bidOfferSignature = await signMarketOffer(kettle, buyer, bidOffer);
      await expect(kettle.connect(seller).sellWithLoan(
        tokenId,
        loanOffer,
        bidOffer,
        loanOfferSignature,
        bidOfferSignature,
        [],
        []
      )).to.be.revertedWithCustomError(kettle, "CurrencyMismatch");
    });

    it("should fail if sizes do not match", async () => {
      bidOffer.collateral.size = 2;
      bidOfferSignature = await signMarketOffer(kettle, buyer, bidOffer);
      await expect(kettle.connect(seller).sellWithLoan(
        tokenId,
        loanOffer,
        bidOffer,
        loanOfferSignature,
        bidOfferSignature,
        [],
        []
      )).to.be.revertedWithCustomError(kettle, "SizeMismatch");
    });
  })
});
