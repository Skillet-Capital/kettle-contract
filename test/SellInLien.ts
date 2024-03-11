import { time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ContractTransactionResponse, Signer } from "ethers";

import { getFixture } from './setup';
import { signLoanOffer, signMarketOffer } from "./helpers/signatures";
import { extractBorrowLog, extractSellInLienLog } from './helpers/events';
import { randomBytes, generateMerkleRootForCollection, generateMerkleProofForToken, hashIdentifier } from './helpers/merkle';

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

describe("Sell In Lien", function () {

  let seller: Signer;
  let buyer: Signer;

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
    seller = fixture.borrower;
    buyer = fixture.offerMaker;

    lender = fixture.lender;
    recipient = fixture.recipient;
    marketFeeRecipient = fixture.marketFeeRecipient;

    kettle = fixture.kettle;
    receipt = fixture.receipt;

    tokens = fixture.tokens;
    tokenId = fixture.tokenId;
    principal = fixture.principal;

    testErc721 = fixture.testErc721;
    testErc20 = fixture.testErc20;
  });

  let txn: ContractTransactionResponse;

  let lienId: string | number | bigint;
  let lien: LienStruct;

  let bidOffer: MarketOfferStruct;

  let feeTerms: FeeTermsStruct;
  let terms: MarketOfferTermsStruct;
  let collateral: CollateralStruct;

  let marketOfferSignature: string;

  let sellerBalance_before: bigint;
  let buyerBalance_before: bigint;
  let lenderBalance_before: bigint;
  let recipientBalance_before: bigint;
  let marketFeeRecipientBalance_before: bigint;

  let debt: bigint;
  let interest: bigint;
  let fee: bigint;

  beforeEach(async () => {
    const loanOfferTerms: LoanOfferTermsStruct = {
      currency: testErc20,
      totalAmount: principal,
      maxAmount: principal,
      minAmount: principal,
      rate: "1000",
      defaultRate: "2000",
      duration: MONTH_SECONDS,
      gracePeriod: MONTH_SECONDS
    }

    const loanOfferFeeTerms: FeeTermsStruct = {
      recipient: recipient,
      rate: "200"
    }

    collateral = {
      collection: testErc721,
      itemType: 0,
      criteria: 0,
      identifier: tokenId,
      size: 1
    }

    const offer: LoanOfferStruct = {
      lender,
      collateral,
      terms: loanOfferTerms,
      fee: loanOfferFeeTerms,
      salt: randomBytes(),
      expiration: await time.latest() + DAY_SECONDS
    }

    const signature = await signLoanOffer(kettle, lender, offer);

    const txn = await kettle.connect(seller).borrow(offer, principal, 1, seller, signature, []);
    ({ lienId, lien } = await txn.wait().then(receipt => extractBorrowLog(receipt!)));

    expect(await receipt.ownerOf(lienId)).to.equal(lender);

    terms = {
      currency: testErc20,
      amount: principal,
      withLoan: false,
      borrowAmount: 0,
      loanOfferHash: BYTES_ZERO
    }

    feeTerms = {
      recipient: marketFeeRecipient,
      rate: 200
    }

    bidOffer = {
      side: 0,
      maker: buyer,
      collateral: { ...collateral },
      terms,
      fee: feeTerms,
      salt: randomBytes(),
      expiration: await time.latest() + DAY_SECONDS
    }

    marketOfferSignature = await signMarketOffer(kettle, buyer, bidOffer);

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

        bidOffer.collateral.criteria = criteria;
        bidOffer.collateral.identifier = identifier;

        marketOfferSignature = await signMarketOffer(kettle, buyer, bidOffer);
      });

      for (var i = 0; i < 2; i++) {
        const delinquent = i === 1;

        describe(`[${delinquent ? 'DELINQUENT' : 'CURRENT'}] should sell an asset in a lien into a bid`, () => {
          beforeEach(async () => {
            if (delinquent) {
              await time.increase(MONTH_SECONDS + HALF_MONTH_SECONDS);
              bidOffer.expiration = await time.latest() + DAY_SECONDS;
              marketOfferSignature = await signMarketOffer(kettle, buyer, bidOffer);
            
            } else {
              await time.increase(HALF_MONTH_SECONDS);
              bidOffer.expiration = await time.latest() + DAY_SECONDS;
              marketOfferSignature = await signMarketOffer(kettle, buyer, bidOffer);
            }

            expect(await testErc721.ownerOf(tokenId)).to.eq(kettle);

            ({ debt, interest, fee } = await kettle.currentDebtAmount(lien));
          });

          afterEach(async () => {
            const sellInLienLog = await txn.wait().then(receipt => extractSellInLienLog(receipt!));

            const marketFeeAmount = (BigInt(bidOffer.terms.amount) * BigInt(bidOffer.fee.rate)) / 10_000n;
            const netSellAmount = BigInt(bidOffer.terms.amount) - marketFeeAmount;
            const netPrincipalAmount = netSellAmount - sellInLienLog.debt;

            // balance checks
            expect(await testErc721.ownerOf(tokenId)).to.equal(buyer);
            expect(await testErc20.balanceOf(seller)).to.equal(sellerBalance_before + netPrincipalAmount);
            expect(await testErc20.balanceOf(buyer)).to.equal(buyerBalance_before - BigInt(bidOffer.terms.amount));
            expect(await testErc20.balanceOf(lender)).to.equal(lenderBalance_before + sellInLienLog.principal + sellInLienLog.interest);
            expect(await testErc20.balanceOf(recipient)).to.equal(recipientBalance_before + sellInLienLog.fee);
            expect(await testErc20.balanceOf(marketFeeRecipient)).to.equal(marketFeeRecipientBalance_before + marketFeeAmount);

            // logging check
            expect(sellInLienLog.lienId).to.equal(lienId);
            expect(sellInLienLog.buyer).to.equal(bidOffer.maker).to.equal(buyer);
            expect(sellInLienLog.seller).to.equal(seller).to.equal(lien.borrower);
            expect(sellInLienLog.currency).to.equal(testErc20);
            expect(sellInLienLog.collection).to.equal(testErc721);
            expect(sellInLienLog.tokenId).to.equal(tokenId);
            expect(sellInLienLog.size).to.equal(1);
            expect(sellInLienLog.amount).to.equal(bidOffer.terms.amount);
            expect(sellInLienLog.netAmount).to.equal(netSellAmount);

            expect(sellInLienLog.principal).to.equal(principal);
            expect(sellInLienLog.debt).to.be.within(debt, debt + 100n);
            expect(sellInLienLog.interest).to.be.within(interest, interest + 100n);
            expect(sellInLienLog.fee).to.be.within(fee, fee + 100n);

            await expect(receipt.ownerOf(lienId)).to.be.revertedWith("NOT_MINTED");
          })

          it("bid amount > amountOwed", async () => {
            bidOffer.terms.amount = principal * 2n;
            marketOfferSignature = await signMarketOffer(kettle, buyer, bidOffer);

            txn = await kettle.connect(seller).sellInLien(
              lienId,
              lien,
              bidOffer,
              marketOfferSignature,
              proof
            );
          });

          it("amountOwed > bid amount > principal + interest", async () => {
            bidOffer.terms.amount = principal + interest + (fee / 2n);
            marketOfferSignature = await signMarketOffer(kettle, buyer, bidOffer);

            txn = await kettle.connect(seller).sellInLien(
              lienId,
              lien,
              bidOffer,
              marketOfferSignature,
              proof
            );
          });

          it("amountOwed > bid amount > principal", async () => {
            bidOffer.terms.amount = principal + (interest / 2n);
            marketOfferSignature = await signMarketOffer(kettle, buyer, bidOffer);

            txn = await kettle.connect(seller).sellInLien(
              lienId,
              lien,
              bidOffer,
              marketOfferSignature,
              proof
            );
          });

          it("bid amount < principal", async () => {
            bidOffer.terms.amount = principal / 2n;
            marketOfferSignature = await signMarketOffer(kettle, buyer, bidOffer);
            
            txn = await kettle.connect(seller).sellInLien(
              lienId,
              lien,
              bidOffer,
              marketOfferSignature,
              proof
            );
          });
        });
      }
    });
  }

  it('should fail if lien is defaulted', async () => {
    await time.increase(MONTH_SECONDS + MONTH_SECONDS);

    await expect(kettle.connect(seller).sellInLien(
      lienId,
      lien,
      bidOffer,
      marketOfferSignature,
      []
    )).to.be.revertedWithCustomError(kettle, "LienDefaulted");
  })

  it('should fail if side is not bid', async () => {
    bidOffer.side = 1;
    marketOfferSignature = await signMarketOffer(kettle, buyer, bidOffer);
    await expect(kettle.connect(seller).sellInLien(
      lienId,
      lien,
      bidOffer,
      marketOfferSignature,
      []
    )).to.be.revertedWithCustomError(kettle, "OfferNotBid");
  });

  it('should fail if bid requires loan', async () => {
    bidOffer.terms.withLoan = true;
    marketOfferSignature = await signMarketOffer(kettle, buyer, bidOffer);
    await expect(kettle.connect(seller).sellInLien(
      lienId,
      lien,
      bidOffer,
      marketOfferSignature,
      []
    )).to.be.revertedWithCustomError(kettle, "BidRequiresLoan");
  });

  it('should fail if collections do not match', async () => {
    bidOffer.collateral.collection = testErc20;
    marketOfferSignature = await signMarketOffer(kettle, buyer, bidOffer);
    await expect(kettle.connect(seller).sellInLien(
      lienId,
      lien,
      bidOffer,
      marketOfferSignature,
      []
    )).to.be.revertedWithCustomError(kettle, "CollectionMismatch");
  })

  it('should fail if currencies do not match', async () => {
    bidOffer.terms.currency = testErc721;
    marketOfferSignature = await signMarketOffer(kettle, buyer, bidOffer);
    await expect(kettle.connect(seller).sellInLien(
      lienId,
      lien,
      bidOffer,
      marketOfferSignature,
      []
    )).to.be.revertedWithCustomError(kettle, "CurrencyMismatch");
  })

  it('should fail if sizes do not match', async () => {
    bidOffer.collateral.size = 2; 
    marketOfferSignature = await signMarketOffer(kettle, buyer, bidOffer);
    await expect(kettle.connect(seller).sellInLien(
      lienId,
      lien,
      bidOffer,
      marketOfferSignature,
      []
    )).to.be.revertedWithCustomError(kettle, "SizeMismatch");
  })
});
