import { expect } from "chai";
import { Signer } from "ethers";

import { getFixture } from './setup';
import { extractBorrowLog, extractBuyWithLoanLog } from './helpers/events';
import { generateMerkleRootForCollection, generateMerkleProofForToken } from './helpers/merkle';

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

  let buyer: Signer;
  let seller: Signer;

  let lender: Signer;
  let recipient: Signer;

  let kettle: Kettle;

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

  beforeEach(async () => {

    loanOffer = {
      lender: lender,
      recipient: recipient,
      currency: testErc20,
      collection: testErc721,
      criteria: 0,
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

    askOffer = {
      side: 1,
      maker: seller,
      currency: testErc20,
      collection: testErc721,
      criteria: 0,
      identifier: BigInt(tokenId),
      size: 1,
      amount: principal * 3n / 2n,
      withLoan: false,
      borrowAmount: 0
    }
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
          proof,
          proof
        );
    
        // after checks
        expect(await testErc721.ownerOf(tokenId)).to.equal(kettle);
        expect(await testErc20.balanceOf(seller)).to.equal(sellerBalance_before + BigInt(askOffer.amount));
        expect(await testErc20.balanceOf(buyer)).to.equal(buyerBalance_before - (BigInt(askOffer.amount) - borrowAmount));
        expect(await testErc20.balanceOf(lender)).to.equal(lenderBalance_before - borrowAmount);
    
        // logging checks
        const { borrowLog, buyWithLoanLog } = await txn.wait().then(receipt => ({
          borrowLog: extractBorrowLog(receipt!),
          buyWithLoanLog: extractBuyWithLoanLog(receipt!)
        }));
    
        expect(borrowLog.lienId).to.equal(buyWithLoanLog.lienId);
        expect(borrowLog.lien.borrower).to.equal(buyWithLoanLog.buyer).to.equal(buyer);
        expect(borrowLog.lien.lender).to.equal(loanOffer.lender);
        expect(borrowLog.lien.collection).to.equal(buyWithLoanLog.collection);
        expect(borrowLog.lien.tokenId).to.equal(buyWithLoanLog.tokenId);
        expect(borrowLog.lien.principal).to.equal(buyWithLoanLog.borrowAmount);
        expect(buyWithLoanLog.seller).to.equal(askOffer.maker).to.equal(seller);
    
        expect(buyWithLoanLog.borrowAmount).to.equal(borrowLog.lien.principal).to.equal(borrowAmount);
    
      });
    
      it("should purchase an asset with an ask using a loan (amount > ask)", async () => {
        const borrowAmount = principal * 2n;
        
        // before checks
        const sellerBalance_before = await testErc20.balanceOf(seller);
        const buyerBalance_before = await testErc20.balanceOf(buyer);
        const lenderBalance_before = await testErc20.balanceOf(lender);
    
        const txn = await kettle.connect(buyer).buyWithLoan(
          tokenId,
          borrowAmount,
          loanOffer,
          { ...askOffer, amount: principal },
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
        expect(borrowLog.lien.lender).to.equal(loanOffer.lender);
        expect(borrowLog.lien.collection).to.equal(buyWithLoanLog.collection);
        expect(borrowLog.lien.tokenId).to.equal(buyWithLoanLog.tokenId);
        expect(borrowLog.lien.principal).to.equal(buyWithLoanLog.borrowAmount);
        expect(buyWithLoanLog.seller).to.equal(askOffer.maker).to.equal(seller);
    
        expect(buyWithLoanLog.borrowAmount).to.equal(buyWithLoanLog.amount).to.equal(principal);
      });
    });
  }

  it("should fail if side is not ask", async () => {
    const borrowAmount = principal;

    await expect(kettle.connect(buyer).buyWithLoan(
      tokenId,
      borrowAmount,
      loanOffer,
      { ...askOffer, side: 0 },
      [],
      []
    )).to.be.revertedWithCustomError(kettle, "OfferNotAsk");  
  });

  it("should fail if collections do not match", async () => {
    const borrowAmount = principal;

    await expect(kettle.connect(buyer).buyWithLoan(
      tokenId,
      borrowAmount,
      loanOffer,
      { ...askOffer, collection: testErc20 },
      [],
      []
    )).to.be.revertedWithCustomError(kettle, "CollectionMismatch");  
  });

  it("should fail if currencies do not match", async () => {
    const borrowAmount = principal;

    await expect(kettle.connect(buyer).buyWithLoan(
      tokenId,
      borrowAmount,
      loanOffer,
      { ...askOffer, currency: testErc721 },
      [],
      []
    )).to.be.revertedWithCustomError(kettle, "CurrencyMismatch");  
  });

  it("should fail if sizes do not match", async () => {
    const borrowAmount = principal;

    await expect(kettle.connect(buyer).buyWithLoan(
      tokenId,
      borrowAmount,
      loanOffer,
      { ...askOffer, size: 2 },
      [],
      []
    )).to.be.revertedWithCustomError(kettle, "SizeMismatch");  
  });
});
