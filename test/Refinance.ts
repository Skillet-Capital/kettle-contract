import { time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ContractTransactionResponse, Signer } from "ethers";

import { getFixture } from './setup';
import { signLoanOffer } from "./helpers/signatures";
import { extractBorrowLog, extractRefinanceLog } from './helpers/events';
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
  FeeTermsStruct 
} from "../typechain-types/contracts/Kettle";

const DAY_SECONDS = 86400;
const MONTH_SECONDS = DAY_SECONDS * 365 / 12;
const HALF_MONTH_SECONDS = MONTH_SECONDS / 2;

describe("Refinance", function () {

  let owner: Signer;
  let borrower: Signer;
  let lender: Signer;
  let lender2: Signer;
  let recipient: Signer;

  let kettle: Kettle;
  let receipt: LenderReceipt;

  let tokens: number[];
  let tokenId: number;
  let testErc721: TestERC721;

  let principal: bigint;
  let testErc20: TestERC20;


  beforeEach(async () => {
    const fixture = await getFixture();
    owner = fixture.owner;
    borrower = fixture.borrower;
    lender = fixture.lender;
    lender2 = fixture.lender2;
    recipient = fixture.recipient;

    kettle = fixture.kettle;
    receipt = fixture.receipt;

    tokens = fixture.tokens;
    tokenId = fixture.tokenId;
    testErc721 = fixture.testErc721;

    principal = fixture.principal;
    testErc20 = fixture.testErc20;
  });

  let txn: ContractTransactionResponse;

  let lienId: string | number | bigint;
  let lien: LienStruct;

  let refinanceOffer: LoanOfferStruct;
  let terms: LoanOfferTermsStruct;
  let collateral: CollateralStruct;
  let feeTerms: FeeTermsStruct;

  let signature: string;

  let refinanceAmount: bigint;

  let debt: bigint;
  let interest: bigint;
  let fee: bigint;

  let borrowerBalance_before: bigint;
  let recipientBalance_before: bigint;
  let lender1Balance_before: bigint;
  let lender2Balance_before: bigint;

  beforeEach(async () => {
    terms = {
      currency: testErc20,
      totalAmount: principal,
      maxAmount: principal,
      minAmount: 0,
      rate: "1000",
      defaultRate: "2000",
      duration: MONTH_SECONDS,
      gracePeriod: MONTH_SECONDS
    }

    collateral = {
      collection: testErc721,
      itemType: 0,
      criteria: 0,
      identifier: tokenId,
      size: 1
    }

    feeTerms = {
      recipient,
      rate: "200"
    }

    const offer: LoanOfferStruct = {
      lender: lender,
      terms,
      collateral,
      fee: feeTerms,
      salt: randomBytes(),
      expiration: await time.latest() + DAY_SECONDS
    }

    signature = await signLoanOffer(kettle, lender, offer);

    const txn = await kettle.connect(borrower).borrow(offer, principal, tokenId, borrower, signature, []);
    ({ lienId, lien } = await txn.wait().then(receipt => extractBorrowLog(receipt!)));

    expect(await receipt.ownerOf(lienId)).to.equal(lender);

    borrowerBalance_before = await testErc20.balanceOf(borrower);
    recipientBalance_before = await testErc20.balanceOf(recipient);
    lender1Balance_before = await testErc20.balanceOf(lender);
    lender2Balance_before = await testErc20.balanceOf(lender2);
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
      });

      for (var i=0; i<2; i++) {
        const delinquent = i === 1;

        describe(`[${delinquent ? 'DELINQUENT' : 'CURRENT'}] should purchase a listed asset in a lien with a loan offer`, () => {
          beforeEach(async () => {
            if (delinquent) {
              await time.increase(MONTH_SECONDS + HALF_MONTH_SECONDS);
            } else {
              await time.increase(HALF_MONTH_SECONDS);
            }

            refinanceOffer = {
              lender: lender2,
              terms: {
                ...terms,
                totalAmount: principal * 2n,
                maxAmount: principal * 2n,
                minAmount: 0
              },
              collateral: {
                ...collateral,
                criteria,
                identifier,
              },
              fee: feeTerms,
              salt: randomBytes(),
              expiration: await time.latest() + DAY_SECONDS
            }
    
            signature = await signLoanOffer(kettle, lender2, refinanceOffer);

            ({ debt, fee, interest } = await kettle.currentDebtAmount(lien));
          });

          afterEach(async () => {
            const refinanceLog = await txn.wait().then(receipt => extractRefinanceLog(receipt!));

            let netPrincipalAmount = refinanceAmount - refinanceLog.debt;
            expect(await testErc20.balanceOf(borrower)).to.equal(borrowerBalance_before + netPrincipalAmount);
            expect(await testErc20.balanceOf(recipient)).to.equal(recipientBalance_before + refinanceLog.fee);
            expect(await testErc20.balanceOf(lender)).to.equal(lender1Balance_before + principal + refinanceLog.interest);
            expect(await testErc20.balanceOf(lender2)).to.equal(lender2Balance_before - refinanceAmount);

            expect(await receipt.ownerOf(refinanceLog.newLienId)).to.equal(lender2);

            expect(refinanceLog.oldLienId).to.equal(lienId);
            await expect(receipt.ownerOf(lienId)).to.be.revertedWith("NOT_MINTED");
          })

          it("amount > balance", async () => {
            refinanceAmount = principal * 2n;
      
            txn = await kettle.connect(borrower).refinance(
              lienId,
              refinanceAmount,
              lien,
              refinanceOffer,
              signature,
              proof
            );
          })
      
          it("balance > amount > principal + interest", async () => {
            refinanceAmount = principal + interest + (fee / 2n);
            txn = await kettle.connect(borrower).refinance(
              lienId,
              refinanceAmount,
              lien,
              refinanceOffer,
              signature,
              proof
            );
          });
      
          it("amount > principal", async () => {
            refinanceAmount = principal + (interest / 2n);
      
            txn = await kettle.connect(borrower).refinance(
              lienId,
              refinanceAmount,
              lien,
              refinanceOffer,
              signature,
              proof
            );
          });
      
          it("amount < principal", async () => {
            refinanceAmount = principal / 2n;
      
            txn = await kettle.connect(borrower).refinance(
              lienId,
              refinanceAmount,
              lien,
              refinanceOffer,
              signature,
              proof
            );
          })
        });
      }
    });
  }
});
