import { time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ContractTransactionResponse, Signer } from "ethers";

import { AddressZero } from "@ethersproject/constants"

import { getFixture } from './setup';
import { signLoanOffer, signMarketOffer } from "./helpers/signatures";
import { extractBorrowLog, extractBuyInLienWithLoanLog } from './helpers/events';
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

const BYTES_ZERO = "0x0000000000000000000000000000000000000000000000000000000000000000";

describe("Buy In Lien With Loan", function () {

  let seller: Signer;
  let buyer: Signer;

  let lender: Signer;
  let lender2: Signer;

  let recipient: Signer;
  let marketFeeRecipient: Signer;

  let kettle: Kettle;

  let tokens: number[];
  let tokenId: number;
  let testErc721: TestERC721;

  let principal: bigint;
  let testErc20: TestERC20;


  beforeEach(async () => {
    const fixture = await getFixture();
    
    seller = fixture.borrower;
    buyer = fixture.offerMaker;

    lender = fixture.lender;
    lender2 = fixture.lender2;
    
    recipient = fixture.recipient;
    marketFeeRecipient = fixture.marketFeeRecipient;

    kettle = fixture.kettle;

    testErc721 = fixture.testErc721;
    testErc20 = fixture.testErc20;

    tokens = fixture.tokens;
    tokenId = fixture.tokenId;
    principal = fixture.principal;
  });

  let lienId: string | number | bigint;
  let lien: LienStruct;

  let loanOffer: LoanOfferStruct;
  let askOffer: MarketOfferStruct;

  let txn: ContractTransactionResponse; 

  let loanOfferSignature: string;
  let askOfferSignature: string;

  let borrowAmount: bigint;
  let marketFeeAmount: bigint;

  let balance: bigint;
  let pastInterest: bigint;
  let pastFee: bigint;
  let currentInterest: bigint;
  let currentFee: bigint;

  let didRevert: boolean;

  beforeEach(async () => {
    const terms: LoanOfferTermsStruct = {
      currency: testErc20,
      totalAmount: principal,
      maxAmount: principal,
      minAmount: principal,
      rate: "1000",
      defaultRate: "2000",
      period: MONTH_SECONDS,
      gracePeriod: MONTH_SECONDS,
      installments: 12
    }

    const collateral: CollateralStruct = {
      collection: testErc721,
      criteria: 0,
      identifier: tokenId,
      size: 1
    }

    const fee: FeeTermsStruct = {
      recipient: recipient,
      rate: "200"
    }

    const offer = {
      lender: lender,
      collateral,
      terms,
      fee,
      salt: randomBytes(),
      expiration: await time.latest() + DAY_SECONDS
    }

    const signature = await signLoanOffer(kettle, lender, offer);

    const txn = await kettle.connect(seller).borrow(offer, principal, 1, AddressZero, signature, []);
      ({ lienId, lien } = await txn.wait().then(receipt => extractBorrowLog(receipt!))
    );

    const askOfferTerms = {
      currency: testErc20,
      amount: principal,
      withLoan: false,
      borrowAmount: 0,
      loanOfferHash: BYTES_ZERO
    }

    const askOfferFee = {
      recipient: marketFeeRecipient,
      rate: 200
    }

    askOffer = {
      side: 1,
      maker: seller,
      terms: askOfferTerms,
      collateral: { ...collateral },
      fee: askOfferFee,
      salt: randomBytes(),
      expiration: await time.latest() + DAY_SECONDS
    }

    loanOffer = offer;
    loanOffer.lender = lender2;
    loanOffer.terms.totalAmount = principal * 2n;
    loanOffer.terms.maxAmount = principal * 2n;
    loanOffer.terms.minAmount = 0;

    loanOfferSignature = await signLoanOffer(kettle, lender2, loanOffer);
    askOfferSignature = await signMarketOffer(kettle, seller, askOffer);
  });

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

        loanOfferSignature = await signLoanOffer(kettle, lender2, loanOffer);
        askOfferSignature = await signMarketOffer(kettle, seller, askOffer);
      });

      for (var i=0; i<2; i++) {
        const delinquent = i === 1;

        describe(`[${delinquent ? 'DELINQUENT' : 'CURRENT'}] should purchase a listed asset in a lien with a loan offer`, () => {
          let sellerBalance_before: bigint;
          let buyerBalance_before: bigint;
          
          let lenderBalance_before: bigint;
          let lender2Balance_before: bigint;
          
          let recipientBalance_before: bigint;
          let marketFeeRecipientBalance_before: bigint;
      
          beforeEach(async () => {
            didRevert = false;
            if (delinquent) {
              await time.increase(MONTH_SECONDS + HALF_MONTH_SECONDS);

              askOffer.expiration = await time.latest() + DAY_SECONDS;
              loanOffer.expiration = await time.latest() + DAY_SECONDS;

              loanOfferSignature = await signLoanOffer(kettle, lender2, loanOffer);
              askOfferSignature = await signMarketOffer(kettle, seller, askOffer);
            }

            expect(await testErc721.ownerOf(tokenId)).to.eq(kettle);

            sellerBalance_before = await testErc20.balanceOf(seller);
            buyerBalance_before = await testErc20.balanceOf(buyer);

            lenderBalance_before = await testErc20.balanceOf(lender);
            lender2Balance_before = await testErc20.balanceOf(lender2);

            recipientBalance_before = await testErc20.balanceOf(recipient);
            marketFeeRecipientBalance_before = await testErc20.balanceOf(marketFeeRecipient);

            ({ balance, principal, currentInterest, currentFee, pastFee, pastInterest } = await kettle.payments(lien));
          });

          afterEach(async () => {
            if (!didRevert) {

              const { borrowLog, buyInLienWithLoanLog } = await txn.wait().then(receipt => ({
                borrowLog: extractBorrowLog(receipt!),
                buyInLienWithLoanLog: extractBuyInLienWithLoanLog(receipt!)
              }));

              // balance checks
              const netAmount = BigInt(askOffer.terms.amount) - marketFeeAmount;
              expect(buyInLienWithLoanLog.netAmount).to.equal(netAmount);
              const netPurchaseAmount = BigInt(askOffer.terms.amount) - BigInt(borrowAmount);

              expect(await testErc721.ownerOf(tokenId)).to.equal(kettle);
              expect(await testErc20.balanceOf(seller)).to.equal(sellerBalance_before + netAmount - balance);
              expect(await testErc20.balanceOf(buyer)).to.equal(buyerBalance_before - netPurchaseAmount);
              expect(await testErc20.balanceOf(lender)).to.equal(lenderBalance_before + principal + currentInterest + pastInterest);
              expect(await testErc20.balanceOf(lender2)).to.equal(lender2Balance_before - borrowAmount);
              expect(await testErc20.balanceOf(recipient)).to.equal(recipientBalance_before + pastFee + currentFee);
              expect(await testErc20.balanceOf(marketFeeRecipient)).to.equal(marketFeeRecipientBalance_before + marketFeeAmount);

              expect(buyInLienWithLoanLog.oldLienId).to.equal(lienId);
              expect(borrowLog.lienId).to.equal(buyInLienWithLoanLog.newLienId);
              expect(borrowLog.lien.borrower).to.equal(buyInLienWithLoanLog.buyer).to.equal(buyer);
              expect(borrowLog.lien.lender).to.equal(loanOffer.lender).to.equal(lender2);
              expect(borrowLog.lien.collection).to.equal(buyInLienWithLoanLog.collection);
              expect(borrowLog.lien.tokenId).to.equal(buyInLienWithLoanLog.tokenId);
              expect(borrowLog.lien.principal).to.equal(buyInLienWithLoanLog.borrowAmount);
              expect(buyInLienWithLoanLog.seller).to.equal(askOffer.maker).to.equal(seller);
            }
          })

          it("should revert if ask < owed", async () => {
            askOffer.terms.amount = balance / 2n;
            askOfferSignature = await signMarketOffer(kettle, seller, askOffer);

            borrowAmount = principal;
            await expect(kettle.connect(buyer).buyInLienWithLoan(
              lienId,
              principal,
              lien,
              loanOffer,
              askOffer,
              loanOfferSignature,
              askOfferSignature,
              proof,
              proof
            )).to.be.revertedWithCustomError(kettle, "InsufficientAskAmount");

            didRevert = true;
          })

          it("ask > borrow > owed", async () => {
            askOffer.terms.amount = balance * 2n;
            marketFeeAmount = BigInt(askOffer.terms.amount) * BigInt(askOffer.fee.rate) / 10_000n;
            askOfferSignature = await signMarketOffer(kettle, seller, askOffer);
            
            borrowAmount = balance * 3n / 2n;
            txn = await kettle.connect(buyer).buyInLienWithLoan(
              lienId,
              borrowAmount,
              lien,
              loanOffer,
              askOffer,
              loanOfferSignature,
              askOfferSignature,
              proof,
              proof
            );
          });

          it("ask > owed > borrowAmount > principal + interest", async () => {
            askOffer.terms.amount = balance * 2n;
            marketFeeAmount = BigInt(askOffer.terms.amount) * BigInt(askOffer.fee.rate) / 10_000n;
            askOfferSignature = await signMarketOffer(kettle, seller, askOffer);
            
            borrowAmount = principal + currentInterest + pastInterest + pastFee + (currentFee / 2n);
            expect(borrowAmount).to.be.lt(balance);

            txn = await kettle.connect(buyer).buyInLienWithLoan(
              lienId,
              borrowAmount,
              lien,
              loanOffer,
              askOffer,
              loanOfferSignature,
              askOfferSignature,
              proof,
              proof
            );
          });

          it("ask > owed > principal > borrowAmount", async () => {
            askOffer.terms.amount = balance * 2n;
            marketFeeAmount = BigInt(askOffer.terms.amount) * BigInt(askOffer.fee.rate) / 10_000n;
            askOfferSignature = await signMarketOffer(kettle, seller, askOffer);
            
            borrowAmount = principal / 2n;
            expect(borrowAmount).to.be.lt(balance);

            txn = await kettle.connect(buyer).buyInLienWithLoan(
              lienId,
              borrowAmount,
              lien,
              loanOffer,
              askOffer,
              loanOfferSignature,
              askOfferSignature,
              proof,
              proof
            );
          });

          it("ask > owed > borrowAmount > principal", async () => {
            askOffer.terms.amount = balance * 2n;
            marketFeeAmount = BigInt(askOffer.terms.amount) * BigInt(askOffer.fee.rate) / 10_000n;
            askOfferSignature = await signMarketOffer(kettle, seller, askOffer);
            
            borrowAmount = principal + (currentInterest / 2n) + pastInterest;
            expect(borrowAmount).to.be.lt(balance);

            txn = await kettle.connect(buyer).buyInLienWithLoan(
              lienId,
              borrowAmount,
              lien,
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
    });
  }

  it("should fail if borrower is not offer maker", async () => {
    await expect(kettle.connect(buyer).buyInLienWithLoan(
      lienId,
      principal,
      lien,
      loanOffer,
      { ...askOffer, maker: buyer },
      loanOfferSignature,
      askOfferSignature,
      [],
      []
    )).to.be.revertedWithCustomError(kettle, "MakerIsNotBorrower");  
  });

  it("should fail if offer is not ask", async () => {
    askOffer.side = 0;
    askOfferSignature = await signMarketOffer(kettle, seller, askOffer);
    await expect(kettle.connect(buyer).buyInLienWithLoan(
      lienId,
      principal,
      lien,
      loanOffer,
      askOffer,
      loanOfferSignature,
      askOfferSignature,
      [],
      []
    )).to.be.revertedWithCustomError(kettle, "OfferNotAsk");    
  });

  it("should fail if collections do not match (ask and lien)", async () => {
    askOffer.collateral.collection = testErc20;
    askOfferSignature = await signMarketOffer(kettle, seller, askOffer);
    await expect(kettle.connect(buyer).buyInLienWithLoan(
      lienId,
      principal,
      lien,
      loanOffer,
      askOffer,
      loanOfferSignature,
      askOfferSignature,
      [],
      []
    )).to.be.revertedWithCustomError(kettle, "CollectionMismatch");    
  });

  it("should fail if collections do not match (loan offer and lien)", async () => {
    loanOffer.collateral.collection = testErc20;
    loanOfferSignature = await signLoanOffer(kettle, lender2, loanOffer);
    await expect(kettle.connect(buyer).buyInLienWithLoan(
      lienId,
      principal,
      lien,
      loanOffer,
      askOffer,
      loanOfferSignature,
      askOfferSignature,
      [],
      []
    )).to.be.revertedWithCustomError(kettle, "CollectionMismatch");    
  });

  it("should fail if currencies do not match (ask and lien)", async () => {
    askOffer.terms.currency = testErc721;
    askOfferSignature = await signMarketOffer(kettle, seller, askOffer);
    await expect(kettle.connect(buyer).buyInLienWithLoan(
      lienId,
      principal,
      lien,
      loanOffer,
      askOffer,
      loanOfferSignature,
      askOfferSignature,
      [],
      []
    )).to.be.revertedWithCustomError(kettle, "CurrencyMismatch");    
  });

  it("should fail if currencies do not match (loan offer and lien)", async () => {
    loanOffer.terms.currency = testErc721;
    loanOfferSignature = await signLoanOffer(kettle, lender2, loanOffer);
    await expect(kettle.connect(buyer).buyInLienWithLoan(
      lienId,
      principal,
      lien,
      loanOffer,
      askOffer,
      loanOfferSignature,
      askOfferSignature,
      [],
      []
    )).to.be.revertedWithCustomError(kettle, "CurrencyMismatch");    
  });

  it("should fail if sizes do not match (ask and lien)", async () => {
    askOffer.collateral.size = 2;
    askOfferSignature = await signMarketOffer(kettle, seller, askOffer);
    await expect(kettle.connect(buyer).buyInLienWithLoan(
      lienId,
      principal,
      lien,
      loanOffer,
      askOffer,
      loanOfferSignature,
      askOfferSignature,
      [],
      []
    )).to.be.revertedWithCustomError(kettle, "SizeMismatch");    
  });

  it("should fail if sizes do not match (loan offer and lien)", async () => {
    loanOffer.collateral.size = 2;
    loanOfferSignature = await signLoanOffer(kettle, lender2, loanOffer);
    await expect(kettle.connect(buyer).buyInLienWithLoan(
      lienId,
      principal,
      lien,
      loanOffer,
      askOffer,
      loanOfferSignature,
      askOfferSignature,
      [],
      []
    )).to.be.revertedWithCustomError(kettle, "SizeMismatch");    
  });
});
