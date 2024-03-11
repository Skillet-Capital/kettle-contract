import { time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { Signer } from "ethers";

import { getFixture } from './setup';
import { signLoanOffer, signMarketOffer } from "./helpers/signatures";
import { extractBuyInLienLog, extractBorrowLog } from './helpers/events';
import { randomBytes, generateMerkleRootForCollection, generateMerkleProofForToken } from './helpers/merkle';

import {
  TestERC20,
  TestERC721,
  Kettle,
  LenderReceipt
} from "../typechain-types";

import { 
  LienStruct, 
  LoanOfferStruct, 
  LoanOfferTermsStruct, 
  CollateralStruct, 
  MarketOfferStruct, 
  MarketOfferTermsStruct, 
  FeeTermsStruct 
} from "../typechain-types/contracts/Kettle";

const DAY_SECONDS = 86400;
const MONTH_SECONDS = DAY_SECONDS * 365 / 12;
const HALF_MONTH_SECONDS = MONTH_SECONDS / 2;

const BYTES_ZERO = "0x0000000000000000000000000000000000000000000000000000000000000000";

describe("Buy In Lien", function () {

  let owner: Signer;
  let borrower: Signer;
  let lender: Signer;
  let buyer: Signer;
  let recipient: Signer;
  let marketFeeRecipient: Signer;

  let kettle: Kettle;
  let receipt: LenderReceipt;

  let testErc721: TestERC721;
  let testErc20: TestERC20;

  let tokens: number[];
  let tokenId: number;
  let principal: bigint;

  let lienId: string | number | bigint;
  let lien: LienStruct;

  let loanOffer: LoanOfferStruct;
  let askOffer: MarketOfferStruct;

  let marketOfferSignature: string;

  let buyerBalance_before: bigint;
  let borrowerBalance_before: bigint;
  let lenderBalance_before: bigint;
  let recipientBalance_before: bigint;
  let marketFeeRecipientBalance_before: bigint;

  beforeEach(async () => {
    const fixture = await getFixture();
    owner = fixture.owner;
    borrower = fixture.borrower;
    lender = fixture.lender;
    buyer = fixture.offerMaker;
    recipient = fixture.recipient;
    marketFeeRecipient = fixture.marketFeeRecipient;

    kettle = fixture.kettle;
    receipt = fixture.receipt;

    testErc721 = fixture.testErc721;
    testErc20 = fixture.testErc20;

    tokens = fixture.tokens;
    tokenId = fixture.tokenId;
    principal = fixture.principal;
  });

  beforeEach(async () => {
    const terms: LoanOfferTermsStruct = {
      currency: testErc20,
      totalAmount: principal,
      maxAmount: principal,
      minAmount: principal,
      rate: "1000",
      defaultRate: "2000",
      duration: MONTH_SECONDS,
      gracePeriod: MONTH_SECONDS
    }

    const collateral: CollateralStruct = {
      collection: testErc721,
      itemType: 0,
      criteria: 0,
      identifier: tokenId,
      size: 1
    }

    const feeTerms: FeeTermsStruct = {
      recipient: recipient,
      rate: 200
    }

    loanOffer = {
      lender: lender,
      collateral,
      terms,
      fee: feeTerms,
      salt: randomBytes(),
      expiration: await time.latest() + DAY_SECONDS
    }

    const signature = await signLoanOffer(kettle, lender, loanOffer);

    const txn = await kettle.connect(borrower).borrow(loanOffer, principal, tokenId, borrower, signature, []);
    ({ lienId, lien } = await txn.wait().then(receipt => extractBorrowLog(receipt!)));

    expect(await receipt.ownerOf(lienId)).to.equal(lender);

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
      maker: borrower,
      collateral,
      terms: askOfferTerms,
      fee: askOfferFee,
      salt: randomBytes(),
      expiration: await time.latest() + DAY_SECONDS
    }

    marketOfferSignature = await signMarketOffer(kettle, borrower, askOffer);

    buyerBalance_before = await testErc20.balanceOf(buyer);
    borrowerBalance_before = await testErc20.balanceOf(borrower);
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
        marketOfferSignature = await signMarketOffer(kettle, borrower, askOffer);
      });

      it("should purchase a listed asset in a lien (current lien)", async () => {
        const { debt, fee, interest } = await kettle.currentDebtAmount(lien);
    
        // before checks
        expect(await testErc721.ownerOf(tokenId)).to.equal(kettle);

        // buy in lien
        const txn = await kettle.connect(buyer).buyInLien(
          lienId,
          lien,
          askOffer,
          marketOfferSignature,
          proof
        );

        const buyInLienLog = await txn.wait().then(receipt => extractBuyInLienLog(receipt!));

        // compute amounts
        const marketFeeAmount = BigInt(askOffer.terms.amount) * BigInt(askOffer.fee.rate) / 10000n;
        const netAmount = BigInt(askOffer.terms.amount) - marketFeeAmount;
    
        // after checks
        expect(await testErc721.ownerOf(tokenId)).to.equal(buyer);
        expect(await testErc20.balanceOf(buyer)).to.equal(buyerBalance_before - BigInt(askOffer.terms.amount));
        expect(await testErc20.balanceOf(borrower)).to.equal(borrowerBalance_before + (BigInt(askOffer.terms.amount) - marketFeeAmount - buyInLienLog.debt));
        expect(await testErc20.balanceOf(lender)).to.equal(lenderBalance_before + buyInLienLog.interest + buyInLienLog.principal);
        expect(await testErc20.balanceOf(recipient)).to.equal(recipientBalance_before + buyInLienLog.fee);
        expect(await testErc20.balanceOf(marketFeeRecipient)).to.equal(marketFeeRecipientBalance_before + marketFeeAmount);
    
        expect(buyInLienLog.lienId).to.equal(lienId);
        expect(buyInLienLog.buyer).to.equal(buyer);
        expect(buyInLienLog.seller).to.equal(borrower).to.equal(askOffer.maker);
        expect(buyInLienLog.currency).to.equal(lien.currency);
        expect(buyInLienLog.collection).to.equal(lien.collection);
        expect(buyInLienLog.tokenId).to.equal(lien.tokenId);
        expect(buyInLienLog.size).to.equal(lien.size);
        expect(buyInLienLog.amount).to.equal(askOffer.terms.amount);
        expect(buyInLienLog.netAmount).to.equal(netAmount);
    
        expect(buyInLienLog.principal).to.equal(lien.principal).to.equal(principal);
        expect(buyInLienLog.debt).to.be.within(debt, debt + 100n);
        expect(buyInLienLog.interest).to.be.within(interest, interest + 100n);
        expect(buyInLienLog.fee).to.be.within(fee, fee + 100n);

        await expect(receipt.ownerOf(lienId)).to.be.revertedWith("NOT_MINTED");
      });
  
      it("should purchase a listed asset in a lien (delinquent lien)", async () => {
        await time.increase(MONTH_SECONDS + HALF_MONTH_SECONDS);

        askOffer.expiration = await time.latest() + DAY_SECONDS;
        marketOfferSignature = await signMarketOffer(kettle, borrower, askOffer);
        
        const { debt, fee, interest } = await kettle.currentDebtAmount(lien);
    
        // before checks
        expect(await testErc721.ownerOf(tokenId)).to.equal(kettle);

        const txn = await kettle.connect(buyer).buyInLien(
          lienId,
          lien,
          askOffer,
          marketOfferSignature,
          proof
        );

        const buyInLienLog = await txn.wait().then(receipt => extractBuyInLienLog(receipt!));

        const marketFeeAmount = BigInt(askOffer.terms.amount) * BigInt(askOffer.fee.rate) / 10000n;
        const netAmount = BigInt(askOffer.terms.amount) - marketFeeAmount;
    
        // after checks
        expect(await testErc721.ownerOf(tokenId)).to.equal(buyer);
        expect(await testErc20.balanceOf(buyer)).to.equal(buyerBalance_before - BigInt(askOffer.terms.amount));
        expect(await testErc20.balanceOf(borrower)).to.equal(borrowerBalance_before + (BigInt(askOffer.terms.amount) - marketFeeAmount - buyInLienLog.debt));
        expect(await testErc20.balanceOf(lender)).to.equal(lenderBalance_before + buyInLienLog.interest + buyInLienLog.principal);
        expect(await testErc20.balanceOf(recipient)).to.equal(recipientBalance_before + buyInLienLog.fee);
        expect(await testErc20.balanceOf(marketFeeRecipient)).to.equal(marketFeeRecipientBalance_before + marketFeeAmount);
        
        expect(buyInLienLog.lienId).to.equal(lienId);
        expect(buyInLienLog.buyer).to.equal(buyer);
        expect(buyInLienLog.seller).to.equal(borrower).to.equal(askOffer.maker);
        expect(buyInLienLog.currency).to.equal(lien.currency);
        expect(buyInLienLog.collection).to.equal(lien.collection);
        expect(buyInLienLog.tokenId).to.equal(lien.tokenId);
        expect(buyInLienLog.size).to.equal(lien.size);
        expect(buyInLienLog.amount).to.equal(askOffer.terms.amount);
        expect(buyInLienLog.netAmount).to.equal(netAmount);
    
        expect(buyInLienLog.principal).to.equal(lien.principal).to.equal(principal);
        expect(buyInLienLog.debt).to.be.within(debt, debt + 100n);
        expect(buyInLienLog.interest).to.be.within(interest, interest + 100n);
        expect(buyInLienLog.fee).to.be.within(fee, fee + 100n);
          
        await expect(receipt.ownerOf(lienId)).to.be.revertedWith("NOT_MINTED");
      });
    });
  }

  it("should fail if lien is defaulted", async () => {
    await time.increase(MONTH_SECONDS + MONTH_SECONDS);

    await expect(kettle.connect(buyer).buyInLien(
      lienId,
      lien,
      askOffer,
      marketOfferSignature,
      []
    )).to.be.revertedWithCustomError(kettle, "LienDefaulted");  
  });

  it("should fail if token id does not match identifier", async () => {
    askOffer.collateral.identifier = tokenId + 1;
    marketOfferSignature = await signMarketOffer(kettle, borrower, askOffer);
    await expect(kettle.connect(buyer).buyInLien(
      lienId,
      lien,
      askOffer,
      marketOfferSignature,
      []
    )).to.be.revertedWithCustomError(kettle, "InvalidCriteria");
  });

  it("should fail if criteria expected and does not match", async () => {
    askOffer.collateral.criteria = 1;
    marketOfferSignature = await signMarketOffer(kettle, borrower, askOffer);
    await expect(kettle.connect(buyer).buyInLien(
      lienId,
      lien,
      askOffer,
      marketOfferSignature,
      [
        randomBytes()
      ]
    )).to.be.revertedWithCustomError(kettle, "InvalidCriteria");
  });

  it("should fail if borrower is not offer maker", async () => {
    askOffer.maker = buyer;
    marketOfferSignature = await signMarketOffer(kettle, buyer, askOffer);
    await expect(kettle.connect(buyer).buyInLien(
      lienId,
      lien,
      askOffer,
      marketOfferSignature,
      []
    )).to.be.revertedWithCustomError(kettle, "MakerIsNotBorrower");  
  });

  it("should fail if offer is not ask", async () => {
    askOffer.side = 0;
    marketOfferSignature = await signMarketOffer(kettle, borrower, askOffer);
    await expect(kettle.connect(buyer).buyInLien(
      lienId,
      lien,
      askOffer,
      marketOfferSignature,
      []
    )).to.be.revertedWithCustomError(kettle, "OfferNotAsk");  
  });

  it("should fail if collections do not match", async () => {
    askOffer.collateral.collection = testErc20;
    marketOfferSignature = await signMarketOffer(kettle, borrower, askOffer);
    await expect(kettle.connect(borrower).buyInLien(
      lienId,
      lien,
      askOffer,
      marketOfferSignature,
      []
    )).to.be.revertedWithCustomError(kettle, "CollectionMismatch");  
  });

  it("should fail if currencies do not match", async () => {
    askOffer.terms.currency = testErc721;
    marketOfferSignature = await signMarketOffer(kettle, borrower, askOffer);
    await expect(kettle.connect(borrower).buyInLien(
      lienId,
      lien,
      askOffer,
      marketOfferSignature,
      []
    )).to.be.revertedWithCustomError(kettle, "CurrencyMismatch");  
  });

  it("should fail if sizes do not match", async () => {
    askOffer.collateral.size = 2;
    marketOfferSignature = await signMarketOffer(kettle, borrower, askOffer);
    await expect(kettle.connect(borrower).buyInLien(
      lienId,
      lien,
      askOffer,
      marketOfferSignature,
      []
    )).to.be.revertedWithCustomError(kettle, "SizeMismatch");  
  });

  it("should fail if ask amount does not cover debt", async () => {
    askOffer.terms.amount = principal;
    marketOfferSignature = await signMarketOffer(kettle, borrower, askOffer);
    await expect(kettle.connect(borrower).buyInLien(
      lienId,
      lien,
      askOffer,
      marketOfferSignature,
      []
    )).to.be.revertedWithCustomError(kettle, "InsufficientAskAmount");  
  });
});
