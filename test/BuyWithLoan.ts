import { time } from "@nomicfoundation/hardhat-toolbox/network-helpers";

import { expect } from "chai";
import { Signer } from "ethers";

import { getFixture } from './setup';
import { signLoanOffer, signMarketOffer } from "./helpers";
import { extractBorrowLog, extractBuyWithLoanLog } from './helpers/events';
import { randomBytes, generateMerkleRootForCollection, generateMerkleProofForToken } from './helpers/merkle';

import {
  TestERC20,
  TestERC721,
  Kettle,
  LenderReceipt
} from "../typechain-types";
import { LienStruct, LoanOfferStruct, LoanOfferTermsStruct, CollateralStruct, MarketOfferStruct, MarketOfferTermsStruct } from "../typechain-types/contracts/Kettle";

const DAY_SECONDS = 86400;
const MONTH_SECONDS = DAY_SECONDS * 365 / 12;
const HALF_MONTH_SECONDS = MONTH_SECONDS / 2;

const BYTES_ZERO = "0x0000000000000000000000000000000000000000000000000000000000000000";

describe("Buy With Loan", function () {

  let buyer: Signer;
  let seller: Signer;

  let lender: Signer;
  let recipient: Signer;

  let kettle: Kettle;
  let receipt: LenderReceipt;

  let tokens: number[];
  let tokenId: number;
  let principal: bigint;

  let testErc721: TestERC721;
  let testErc20: TestERC20;

  beforeEach(async () => {
    const fixture = await getFixture();
    
    buyer = fixture.offerMaker;
    seller = fixture.borrower;
    
    lender = fixture.lender;
    recipient = fixture.recipient;
    
    kettle = fixture.kettle;
    receipt = fixture.receipt;

    testErc721 = fixture.testErc721;

    principal = fixture.principal;
    testErc20 = fixture.testErc20;

    tokenId = fixture.tokenId;
    tokens = fixture.tokens;
  });

  let lienId: string | number | bigint;
  let lien: LienStruct;

  let loanOffer: LoanOfferStruct;
  let askOffer: MarketOfferStruct;

  let loanOfferSignature: string;
  let askOfferSignature: string;

  beforeEach(async () => {

    const loanOfferTerms: LoanOfferTermsStruct = {
      currency: testErc20,
      totalAmount: principal,
      maxAmount: principal,
      minAmount: 0,
      tenor: DAY_SECONDS * 365,
      period: MONTH_SECONDS,
      rate: "1000",
      fee: "200",
      gracePeriod: MONTH_SECONDS
    }

    const collateral: CollateralStruct = {
      collection: testErc721,
      criteria: 0,
      identifier: tokenId,
      size: 1
    }

    loanOffer = {
      lender: lender,
      recipient: recipient,
      terms: loanOfferTerms,
      collateral,
      salt: randomBytes(),
      expiration: await time.latest() + DAY_SECONDS
    }

    const askOfferTerms = {
      currency: testErc20,
      amount: principal * 3n / 2n,
      withLoan: false,
      borrowAmount: 0,
      loanOfferHash: BYTES_ZERO
    }

    askOffer = {
      side: 1,
      maker: seller,
      terms: askOfferTerms,
      collateral: { ...collateral },
      salt: randomBytes(),
      expiration: await time.latest() + DAY_SECONDS
    }

    loanOfferSignature = await signLoanOffer(kettle, lender, loanOffer);
    askOfferSignature = await signMarketOffer(kettle, seller, askOffer);
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

        askOffer.collateral.criteria = criteria;
        askOffer.collateral.identifier = identifier;

        loanOffer.collateral.criteria = criteria;
        loanOffer.collateral.identifier = identifier;

        loanOfferSignature = await signLoanOffer(kettle, lender, loanOffer);
        askOfferSignature = await signMarketOffer(kettle, seller, askOffer);
      });

      it("should purchase an asset with an ask using a loan (amount < ask)", async () => {
        const borrowAmount = principal / 2n;
    
        // before checks
        expect(await testErc721.ownerOf(tokenId)).to.equal(seller);
        const sellerBalance_before = await testErc20.balanceOf(seller);
        const buyerBalance_before = await testErc20.balanceOf(buyer);
        const lenderBalance_before = await testErc20.balanceOf(lender);
    
        const txn = await kettle.connect(buyer).buyWithLoan(
          tokenId,
          borrowAmount,
          loanOffer,
          askOffer,
          loanOfferSignature,
          askOfferSignature,
          proof,
          proof
        );
    
        // after checks
        expect(await testErc721.ownerOf(tokenId)).to.equal(kettle);
        expect(await testErc20.balanceOf(seller)).to.equal(sellerBalance_before + BigInt(askOffer.terms.amount));
        expect(await testErc20.balanceOf(buyer)).to.equal(buyerBalance_before - (BigInt(askOffer.terms.amount) - borrowAmount));
        expect(await testErc20.balanceOf(lender)).to.equal(lenderBalance_before - borrowAmount);
    
        // logging checks
        const { borrowLog, buyWithLoanLog } = await txn.wait().then(receipt => ({
          borrowLog: extractBorrowLog(receipt!),
          buyWithLoanLog: extractBuyWithLoanLog(receipt!)
        }));
    
        expect(borrowLog.lienId).to.equal(buyWithLoanLog.lienId);
        expect(borrowLog.lien.borrower).to.equal(buyWithLoanLog.buyer).to.equal(buyer);
        expect(borrowLog.lien.collection).to.equal(buyWithLoanLog.collection);
        expect(borrowLog.lien.tokenId).to.equal(buyWithLoanLog.tokenId);
        expect(borrowLog.lien.principal).to.equal(buyWithLoanLog.borrowAmount);
        expect(buyWithLoanLog.seller).to.equal(askOffer.maker).to.equal(seller);
    
        expect(buyWithLoanLog.borrowAmount).to.equal(borrowLog.lien.principal).to.equal(borrowAmount);

        expect(await receipt.ownerOf(borrowLog.lienId)).to.equal(lender);
      });
    
      it("should purchase an asset with an ask using a loan (amount > ask)", async () => {
        const borrowAmount = principal * 2n;
        
        // before checks
        const sellerBalance_before = await testErc20.balanceOf(seller);
        const buyerBalance_before = await testErc20.balanceOf(buyer);
        const lenderBalance_before = await testErc20.balanceOf(lender);
        
        askOffer.terms.amount = principal;
        askOfferSignature = await signMarketOffer(kettle, seller, askOffer);
        const txn = await kettle.connect(buyer).buyWithLoan(
          tokenId,
          borrowAmount,
          loanOffer,
          askOffer,
          loanOfferSignature,
          askOfferSignature,
          proof,
          proof
        );
    
        // after checks
        expect(await testErc721.ownerOf(tokenId)).to.equal(kettle);
        expect(await testErc20.balanceOf(seller)).to.equal(sellerBalance_before + principal);
        expect(await testErc20.balanceOf(buyer)).to.equal(buyerBalance_before); // no change
        expect(await testErc20.balanceOf(lender)).to.equal(lenderBalance_before - principal);
    
        const { borrowLog, buyWithLoanLog } = await txn.wait().then(receipt => ({
          borrowLog: extractBorrowLog(receipt!),
          buyWithLoanLog: extractBuyWithLoanLog(receipt!)
        }));
    
        expect(borrowLog.lienId).to.equal(buyWithLoanLog.lienId);
        expect(borrowLog.lien.borrower).to.equal(buyWithLoanLog.buyer).to.equal(buyer);
        expect(borrowLog.lien.collection).to.equal(buyWithLoanLog.collection);
        expect(borrowLog.lien.tokenId).to.equal(buyWithLoanLog.tokenId);
        expect(borrowLog.lien.principal).to.equal(buyWithLoanLog.borrowAmount);
        expect(buyWithLoanLog.seller).to.equal(askOffer.maker).to.equal(seller);
    
        expect(buyWithLoanLog.borrowAmount).to.equal(buyWithLoanLog.amount).to.equal(principal);

        expect(await receipt.ownerOf(borrowLog.lienId)).to.equal(lender);
      });
    });
  }

  it("should fail if side is not ask", async () => {
    const borrowAmount = principal;

    askOffer.side = 0;
    askOfferSignature = await signMarketOffer(kettle, seller, askOffer);
    await expect(kettle.connect(buyer).buyWithLoan(
      tokenId,
      borrowAmount,
      loanOffer,
      askOffer,
      loanOfferSignature,
      askOfferSignature,
      [],
      []
    )).to.be.revertedWithCustomError(kettle, "OfferNotAsk");  
  });

  it("should fail if collections do not match", async () => {
    const borrowAmount = principal;

    askOffer.collateral.collection = testErc20;
    askOfferSignature = await signMarketOffer(kettle, seller, askOffer);
    await expect(kettle.connect(buyer).buyWithLoan(
      tokenId,
      borrowAmount,
      loanOffer,
      askOffer,
      loanOfferSignature,
      askOfferSignature,
      [],
      []
    )).to.be.revertedWithCustomError(kettle, "CollectionMismatch");  
  });

  it("should fail if currencies do not match", async () => {
    const borrowAmount = principal;

    askOffer.terms.currency = testErc721;
    askOfferSignature = await signMarketOffer(kettle, seller, askOffer);
    await expect(kettle.connect(buyer).buyWithLoan(
      tokenId,
      borrowAmount,
      loanOffer,
      askOffer,
      loanOfferSignature,
      askOfferSignature,
      [],
      []
    )).to.be.revertedWithCustomError(kettle, "CurrencyMismatch");  
  });

  it("should fail if sizes do not match", async () => {
    const borrowAmount = principal;

    askOffer.collateral.size = 2;
    loanOffer.collateral.size = 1;
    askOfferSignature = await signMarketOffer(kettle, seller, askOffer);
    loanOfferSignature = await signLoanOffer(kettle, lender, loanOffer);

    await expect(kettle.connect(buyer).buyWithLoan(
      tokenId,
      borrowAmount,
      loanOffer,
      askOffer,
      loanOfferSignature,
      askOfferSignature,
      [],
      []
    )).to.be.revertedWithCustomError(kettle, "SizeMismatch");  
  });
});
