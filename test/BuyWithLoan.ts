import { time } from "@nomicfoundation/hardhat-toolbox/network-helpers";

import { expect } from "chai";
import { ContractTransactionResponse, Signer } from "ethers";

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
import { LienStruct, LoanOfferStruct, LoanOfferTermsStruct, CollateralStruct, MarketOfferStruct, MarketOfferTermsStruct, FeeTermsStruct } from "../typechain-types/contracts/Kettle";

const DAY_SECONDS = 86400;
const MONTH_SECONDS = DAY_SECONDS * 365 / 12;
const HALF_MONTH_SECONDS = MONTH_SECONDS / 2;

const BYTES_ZERO = "0x0000000000000000000000000000000000000000000000000000000000000000";

describe("Buy With Loan", function () {

  let buyer: Signer;
  let seller: Signer;

  let lender: Signer;
  let recipient: Signer;
  let marketFeeRecipient: Signer;

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
    marketFeeRecipient = fixture.marketFeeRecipient;
    
    kettle = fixture.kettle;
    receipt = fixture.receipt;

    testErc721 = fixture.testErc721;
    testErc20 = fixture.testErc20;

    principal = fixture.principal;
    tokenId = fixture.tokenId;
    tokens = fixture.tokens;
  });

  let txn: ContractTransactionResponse;

  let lienId: string | number | bigint;
  let lien: LienStruct;

  let loanOffer: LoanOfferStruct;
  let askOffer: MarketOfferStruct;

  let loanOfferSignature: string;
  let askOfferSignature: string;

  let borrowAmount: bigint;
  let marketFeeAmount: bigint;

  let sellerBalance_before: bigint;
  let buyerBalance_before: bigint;
  
  let lenderBalance_before: bigint;  
  let recipientBalance_before: bigint;
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
      itemType: 0,
      criteria: 0,
      identifier: tokenId,
      size: 1
    }

    loanOffer = {
      lender: lender,
      terms: loanOfferTerms,
      collateral: { ...collateral },
      fee: loanOfferFee,
      salt: randomBytes(),
      expiration: await time.latest() + DAY_SECONDS
    }

    const askOfferTerms: MarketOfferTermsStruct = {
      currency: testErc20,
      amount: principal * 3n / 2n,
      withLoan: false,
      borrowAmount: 0,
      loanOfferHash: BYTES_ZERO
    }

    const askOfferFee: FeeTermsStruct = {
      recipient: marketFeeRecipient,
      rate: 200
    }

    askOffer = {
      side: 1,
      maker: seller,
      terms: askOfferTerms,
      fee: askOfferFee,
      collateral: { ...collateral },
      salt: randomBytes(),
      expiration: await time.latest() + DAY_SECONDS
    }

    loanOfferSignature = await signLoanOffer(kettle, lender, loanOffer);
    askOfferSignature = await signMarketOffer(kettle, seller, askOffer);

    sellerBalance_before = await testErc20.balanceOf(seller);
    buyerBalance_before = await testErc20.balanceOf(buyer);

    lenderBalance_before = await testErc20.balanceOf(lender);
    recipientBalance_before = await testErc20.balanceOf(recipient);
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

        askOffer.collateral.criteria = criteria;
        askOffer.collateral.identifier = identifier;

        loanOffer.collateral.criteria = criteria;
        loanOffer.collateral.identifier = identifier;

        loanOfferSignature = await signLoanOffer(kettle, lender, loanOffer);
        askOfferSignature = await signMarketOffer(kettle, seller, askOffer);
      });

      afterEach(async () => {
        const { borrowLog, buyWithLoanLog } = await txn.wait().then(receipt => ({
          borrowLog: extractBorrowLog(receipt!),
          buyWithLoanLog: extractBuyWithLoanLog(receipt!)
        }));

        const netAmount = BigInt(askOffer.terms.amount) - marketFeeAmount;
        const netPurchaseAmount = BigInt(askOffer.terms.amount) - buyWithLoanLog.borrowAmount;

        // balance checks
        expect(await testErc721.ownerOf(tokenId)).to.equal(kettle);
        expect(await testErc20.balanceOf(seller)).to.equal(sellerBalance_before + netAmount);
        expect(await testErc20.balanceOf(buyer)).to.equal(buyerBalance_before - netPurchaseAmount);
        expect(await testErc20.balanceOf(lender)).to.equal(lenderBalance_before - buyWithLoanLog.borrowAmount);
        expect(await testErc20.balanceOf(marketFeeRecipient)).to.equal(marketFeeRecipientBalance_before + marketFeeAmount);

        // if borrow amount is greater than ask amount, borrow should max at ask amount
        if (BigInt(borrowAmount) > BigInt(askOffer.terms.amount)) {
          expect(buyWithLoanLog.borrowAmount).to.equal(askOffer.terms.amount);
          expect(buyWithLoanLog.amount).to.equal(askOffer.terms.amount);
        }

        // logging checks
        expect(borrowLog.lienId).to.equal(buyWithLoanLog.lienId);
        expect(borrowLog.lien.borrower).to.equal(buyWithLoanLog.buyer).to.equal(buyer);
        expect(borrowLog.lien.collection).to.equal(buyWithLoanLog.collection);
        expect(borrowLog.lien.tokenId).to.equal(buyWithLoanLog.tokenId);
        expect(borrowLog.lien.principal).to.equal(buyWithLoanLog.borrowAmount);
        expect(buyWithLoanLog.seller).to.equal(askOffer.maker).to.equal(seller);
        expect(buyWithLoanLog.netAmount).to.equal(netAmount);

        expect(buyWithLoanLog.borrowAmount)
          .to.equal(borrowLog.lien.principal)
          .to.equal(borrowAmount > BigInt(askOffer.terms.amount) ? askOffer.terms.amount : borrowAmount);

        expect(await receipt.ownerOf(borrowLog.lienId))
          .to.equal(loanOffer.lender)
          .to.equal(lender);
      })

      it("should purchase an asset with an ask using a loan (borrow amount < ask)", async () => {
        borrowAmount = principal / 2n;
        marketFeeAmount = BigInt(askOffer.terms.amount) * BigInt(askOffer.fee.rate) / 10_000n;
        
        txn = await kettle.connect(buyer).buyWithLoan(
          tokenId,
          borrowAmount,
          loanOffer,
          askOffer,
          loanOfferSignature,
          askOfferSignature,
          proof,
          proof
        );    
      });
    
      it("should purchase an asset with an ask using a loan (borrow amount > ask)", async () => {        
        askOffer.terms.amount = principal;
        askOfferSignature = await signMarketOffer(kettle, seller, askOffer);

        borrowAmount = askOffer.terms.amount * 2n;
        marketFeeAmount = BigInt(askOffer.terms.amount) * BigInt(askOffer.fee.rate) / 10_000n;

        txn = await kettle.connect(buyer).buyWithLoan(
          tokenId,
          borrowAmount,
          loanOffer,
          askOffer,
          loanOfferSignature,
          askOfferSignature,
          proof,
          proof
        );
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
