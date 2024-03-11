import { time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ContractTransactionResponse, Signer } from "ethers";

import { getFixture } from './setup';
import { signLoanOffer, signMarketOffer } from "./helpers/signatures";
import { extractBorrowLog, extractSellInLienWithLoanLog } from './helpers/events';
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

describe("Sell In Lien With Loan", function () {

  let seller: Signer;
  let buyer: Signer;

  let lender: Signer;
  let lender2: Signer;

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
    seller = fixture.borrower;
    buyer = fixture.offerMaker;

    lender = fixture.lender;
    lender2 = fixture.lender2;
    recipient = fixture.recipient;
    marketFeeRecipient = fixture.marketFeeRecipient;

    kettle = fixture.kettle;
    receipt = fixture.receipt;

    tokenId = fixture.tokenId;
    tokens = fixture.tokens;
    principal = fixture.principal;

    testErc721 = fixture.testErc721;
    testErc20 = fixture.testErc20;
  });

  let txn: ContractTransactionResponse;

  let lienId: string | number | bigint;
  let lien: LienStruct;

  let loanOffer: LoanOfferStruct;
  let bidOffer: MarketOfferStruct;

  let loanOfferTerms: LoanOfferTermsStruct;
  let bidOfferTerms: MarketOfferTermsStruct;

  let loanOfferSignature: string;
  let bidOfferSignature: string;

  let marketFeeAmount: bigint;

  let debt: bigint;
  let interest: bigint;
  let fee: bigint;

  let sellerBalance_before: bigint;
  let buyerBalance_before: bigint;

  let lenderBalance_before: bigint;
  let lender2Balance_before: bigint;

  let recipientBalance_before: bigint;
  let marketFeeRecipientBalance_before: bigint;

  beforeEach(async () => {
    const terms: LoanOfferTermsStruct = {
      currency: testErc20,
      totalAmount: principal,
      maxAmount: principal,
      minAmount: 0,
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
      rate: "200"
    }

    const offer = {
      lender: lender,
      collateral,
      terms,
      fee: feeTerms,
      salt: randomBytes(),
      expiration: await time.latest() + DAY_SECONDS
    }

    const signature = await signLoanOffer(kettle, lender, offer);

    const txn = await kettle.connect(seller).borrow(offer, principal, 1, seller, signature, []);
    ({ lienId, lien } = await txn.wait().then(receipt => extractBorrowLog(receipt!)));

    expect(await receipt.ownerOf(lienId)).to.equal(lender);

    loanOffer = {
      lender: lender2,
      terms,
      fee: feeTerms,
      collateral: { ...collateral },
      salt: randomBytes(),
      expiration: await time.latest() + DAY_SECONDS
    }

    const loanOfferHash = await kettle.hashLoanOffer(loanOffer);

    bidOfferTerms = {
      currency: testErc20,
      amount: principal,
      withLoan: true,
      borrowAmount: principal,
      loanOfferHash
    }

    const bidOfferFeeTerms = {
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

    loanOfferSignature = await signLoanOffer(kettle, lender2, loanOffer);
    bidOfferSignature = await signMarketOffer(kettle, buyer, bidOffer);

    sellerBalance_before = await testErc20.balanceOf(seller);
    buyerBalance_before = await testErc20.balanceOf(buyer);

    lenderBalance_before = await testErc20.balanceOf(lender);
    lender2Balance_before = await testErc20.balanceOf(lender2);

    recipientBalance_before = await testErc20.balanceOf(recipient);
    marketFeeRecipientBalance_before = await testErc20.balanceOf(marketFeeRecipient);
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

        loanOffer.collateral.criteria = criteria;
        loanOffer.collateral.identifier = identifier;

        bidOffer.collateral.criteria = criteria;
        bidOffer.collateral.identifier = identifier;

        loanOfferSignature = await signLoanOffer(kettle, lender2, loanOffer);
        bidOfferSignature = await signMarketOffer(kettle, buyer, bidOffer);
      });

      for (var i = 0; i < 2; i++) {
        const delinquent = i === 1;

        describe(`[${delinquent ? 'DELINQUENT' : 'CURRENT'}] should purchase a listed asset in a lien with a loan offer`, () => {
          beforeEach(async () => {
            if (delinquent) {
              await time.increase(MONTH_SECONDS + HALF_MONTH_SECONDS);

              loanOffer.expiration = await time.latest() + DAY_SECONDS;
              loanOfferSignature = await signLoanOffer(kettle, lender2, loanOffer);

              bidOffer.expiration = await time.latest() + DAY_SECONDS;
              bidOfferSignature = await signMarketOffer(kettle, buyer, bidOffer);
            } else {
              await time.increase(HALF_MONTH_SECONDS);

              loanOffer.expiration = await time.latest() + DAY_SECONDS;
              loanOfferSignature = await signLoanOffer(kettle, lender2, loanOffer);

              bidOffer.expiration = await time.latest() + DAY_SECONDS;
              bidOfferSignature = await signMarketOffer(kettle, buyer, bidOffer);
            }

            expect(await testErc721.ownerOf(tokenId)).to.eq(kettle);
            ({ debt, interest, fee } = await kettle.currentDebtAmount(lien));
          });

          afterEach(async () => {
            const { borrowLog, sellInLienWithLoanLog } = await txn.wait().then(receipt => ({
              borrowLog: extractBorrowLog(receipt!),
              sellInLienWithLoanLog: extractSellInLienWithLoanLog(receipt!)
            }));

            const marketFeeAmount = (BigInt(bidOffer.terms.amount) * BigInt(bidOffer.fee.rate)) / 10_000n;
            const netSellAmount = BigInt(bidOffer.terms.amount) - marketFeeAmount;
            const netPrincipalAmount = netSellAmount - sellInLienWithLoanLog.debt;
            const netPurchaseAmount = BigInt(bidOffer.terms.amount) - BigInt(bidOffer.terms.borrowAmount);

            // balance checks
            expect(await testErc721.ownerOf(tokenId)).to.equal(kettle);
            expect(await testErc20.balanceOf(seller)).to.equal(sellerBalance_before + netPrincipalAmount);
            expect(await testErc20.balanceOf(buyer)).to.equal(buyerBalance_before - netPurchaseAmount);
            expect(await testErc20.balanceOf(lender)).to.equal(lenderBalance_before + sellInLienWithLoanLog.principal + sellInLienWithLoanLog.interest);
            expect(await testErc20.balanceOf(lender2)).to.equal(lender2Balance_before - BigInt(bidOffer.terms.borrowAmount));
            expect(await testErc20.balanceOf(recipient)).to.equal(recipientBalance_before + sellInLienWithLoanLog.fee);
            expect(await testErc20.balanceOf(marketFeeRecipient)).to.equal(marketFeeRecipientBalance_before + marketFeeAmount);

            // log checks
            expect(sellInLienWithLoanLog.oldLienId).to.equal(lienId);
            expect(sellInLienWithLoanLog.newLienId).to.equal(borrowLog.lienId);
            expect(sellInLienWithLoanLog.buyer).to.equal(borrowLog.lien.borrower).to.equal(buyer);
            expect(sellInLienWithLoanLog.seller).to.equal(lien.borrower).to.equal(seller);
            
            expect(borrowLog.lien.collection).to.equal(sellInLienWithLoanLog.collection);
            expect(borrowLog.lien.tokenId).to.equal(sellInLienWithLoanLog.tokenId);
            
            expect(sellInLienWithLoanLog.amount).to.equal(bidOffer.terms.amount);
            expect(sellInLienWithLoanLog.netAmount).to.equal(netSellAmount);
            expect(sellInLienWithLoanLog.borrowAmount).to.equal(borrowLog.lien.principal).to.equal(bidOffer.terms.borrowAmount);

            expect(sellInLienWithLoanLog.principal).to.equal(principal);
            expect(sellInLienWithLoanLog.debt).to.be.within(debt, debt + 100n);
            expect(sellInLienWithLoanLog.interest).to.be.within(interest, interest + 100n);
            expect(sellInLienWithLoanLog.fee).to.be.within(fee, fee + 100n);

            await expect(receipt.ownerOf(lienId)).to.be.revertedWith("NOT_MINTED");
            expect(await receipt.ownerOf(borrowLog.lienId))
              .to.equal(loanOffer.lender)
              .to.equal(lender2);
          })

          it("bid > balance", async () => {
            bidOffer.terms.amount = debt * 2n;
            bidOfferSignature = await signMarketOffer(kettle, buyer, bidOffer);

            txn = await kettle.connect(seller).sellInLienWithLoan(
              lienId,
              lien,
              loanOffer,
              bidOffer,
              loanOfferSignature,
              bidOfferSignature,
              proof,
              proof
            );
          })

          it("balance > bid > principal + interest", async () => {
            bidOffer.terms.amount = principal + interest + (fee / 2n)
            bidOfferSignature = await signMarketOffer(kettle, buyer, bidOffer);
            
            txn = await kettle.connect(seller).sellInLienWithLoan(
              lienId,
              lien,
              loanOffer,
              bidOffer,
              loanOfferSignature,
              bidOfferSignature,
              proof,
              proof
            );
          });

          it("balance > bid > principal", async () => {
            bidOffer.terms.amount = principal + (interest / 2n);
            bidOfferSignature = await signMarketOffer(kettle, buyer, bidOffer);

            txn = await kettle.connect(seller).sellInLienWithLoan(
              lienId,
              lien,
              loanOffer,
              bidOffer,
              loanOfferSignature,
              bidOfferSignature,
              proof,
              proof
            );
          });

          it("balance > principal > bid", async () => {
            bidOffer.terms.amount = principal / 2n;
            bidOffer.terms.borrowAmount = principal / 3n;
            bidOfferSignature = await signMarketOffer(kettle, buyer, bidOffer);

            txn = await kettle.connect(seller).sellInLienWithLoan(
              lienId,
              lien,
              loanOffer,
              bidOffer,
              loanOfferSignature,
              bidOfferSignature,
              proof,
              proof
            );
          });

          it("balance > principal = bid amount = borrow amount", async () => {
            bidOffer.terms.amount = principal;
            bidOffer.terms.borrowAmount = principal;
            bidOfferSignature = await signMarketOffer(kettle, buyer, bidOffer);

            txn = await kettle.connect(seller).sellInLienWithLoan(
              lienId,
              lien,
              loanOffer,
              bidOffer,
              loanOfferSignature,
              bidOfferSignature,
              proof,
              proof
            );
          });
        });
      }
    });
  }

  it("should fail if caller is not borrower", async () => {
    await expect(kettle.connect(buyer).sellInLienWithLoan(
      lienId,
      lien,
      loanOffer,
      bidOffer,
      loanOfferSignature,
      bidOfferSignature,
      [],
      []
    )).to.be.revertedWithCustomError(kettle, "OnlyBorrower");
  });

  it("should fail if offer is not bid", async () => {
    bidOffer.side = 1;
    bidOfferSignature = await signMarketOffer(kettle, buyer, bidOffer);
    await expect(kettle.connect(seller).sellInLienWithLoan(
      lienId,
      lien,
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
  });

  it("should fail if collections do not match (ask and lien)", async () => {
    bidOffer.collateral.collection = testErc20;
    bidOfferSignature = await signMarketOffer(kettle, buyer, bidOffer);
    await expect(kettle.connect(seller).sellInLienWithLoan(
      lienId,
      lien,
      loanOffer,
      bidOffer,
      loanOfferSignature,
      bidOfferSignature,
      [],
      []
    )).to.be.revertedWithCustomError(kettle, "CollectionMismatch");
  });

  it("should fail if collections do not match (loan offer and lien)", async () => {
    loanOffer.collateral.collection = testErc20;
    loanOfferSignature = await signLoanOffer(kettle, lender2, loanOffer);
    await expect(kettle.connect(seller).sellInLienWithLoan(
      lienId,
      lien,
      loanOffer,
      bidOffer,
      loanOfferSignature,
      bidOfferSignature,
      [],
      []
    )).to.be.revertedWithCustomError(kettle, "CollectionMismatch");
  });

  it("should fail if currencies do not match (ask and lien)", async () => {
    bidOffer.terms.currency = testErc721;
    bidOfferSignature = await signMarketOffer(kettle, buyer, bidOffer);
    await expect(kettle.connect(seller).sellInLienWithLoan(
      lienId,
      lien,
      loanOffer,
      bidOffer,
      loanOfferSignature,
      bidOfferSignature,
      [],
      []
    )).to.be.revertedWithCustomError(kettle, "CurrencyMismatch");
  });

  it("should fail if currencies do not match (loan offer and lien)", async () => {
    loanOffer.terms.currency = testErc721;
    loanOfferSignature = await signLoanOffer(kettle, lender2, loanOffer);
    await expect(kettle.connect(seller).sellInLienWithLoan(
      lienId,
      lien,
      loanOffer,
      bidOffer,
      loanOfferSignature,
      bidOfferSignature,
      [],
      []
    )).to.be.revertedWithCustomError(kettle, "CurrencyMismatch");
  });

  it("should fail if sizes do not match (ask and lien)", async () => {
    bidOffer.collateral.size = 2;
    bidOfferSignature = await signMarketOffer(kettle, buyer, bidOffer);
    await expect(kettle.connect(seller).sellInLienWithLoan(
      lienId,
      lien,
      loanOffer,
      bidOffer,
      loanOfferSignature,
      bidOfferSignature,
      [],
      []
    )).to.be.revertedWithCustomError(kettle, "SizeMismatch");
  });

  it("should fail if sizes do not match (loan offer and lien)", async () => {
    loanOffer.collateral.size = 2;
    loanOfferSignature = await signLoanOffer(kettle, lender2, loanOffer);
    await expect(kettle.connect(seller).sellInLienWithLoan(
      lienId,
      lien,
      loanOffer,
      bidOffer,
      loanOfferSignature,
      bidOfferSignature,
      [],
      []
    )).to.be.revertedWithCustomError(kettle, "SizeMismatch");
  });
});
