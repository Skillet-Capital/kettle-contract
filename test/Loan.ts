import {
  time,
  loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer, parseUnits } from "ethers";

import { getFixture } from './setup';
import { signLoanOffer } from "./helpers/signatures";
import { extractBorrowLog, extractRepayLog } from './helpers/events';
import { randomBytes, generateMerkleRootForCollection, generateMerkleProofForToken, hashIdentifier } from './helpers/merkle';

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

describe("Loan", function () {

  let owner: Signer;
  let borrower: Signer;
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
    owner = fixture.owner;
    borrower = fixture.borrower;
    lender = fixture.lender;
    recipient = fixture.recipient;

    kettle = fixture.kettle;
    receipt = fixture.receipt;

    tokens = fixture.tokens;
    tokenId = fixture.tokenId;
    principal = fixture.principal;

    testErc721 = fixture.testErc721;
    testErc20 = fixture.testErc20;
  });

  for (const criteria of [0, 1]) {
    describe(`criteria: ${criteria == 0 ? "SIMPLE" : "PROOF"}`, () => {
      let lienId: string | number | bigint;
      let lien: LienStruct;

      let proof: string[];
      let identifier: bigint;

      let borrowerBalance_before: bigint;
      let lenderBalance_before: bigint;
      let recipientBalance_before: bigint;

      beforeEach(async () => {
        if (criteria === 0) {
          proof = [];
          identifier = BigInt(tokenId);
        } else {
          proof = generateMerkleProofForToken(tokens, tokenId);
          identifier = BigInt(generateMerkleRootForCollection(tokens));
        }

        const fee: FeeTermsStruct = {
          recipient,
          rate: "200"
        }

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
          criteria: criteria,
          itemType: 0,
          identifier: identifier,
          size: 1
        }

        const loanOffer: LoanOfferStruct = {
          lender: lender,
          terms,
          collateral,
          fee,
          salt: randomBytes(),
          expiration: await time.latest() + DAY_SECONDS
        }

        const signature = await signLoanOffer(kettle, lender, loanOffer);
    
        const txn = await kettle.connect(borrower).borrow(loanOffer, principal, tokenId, borrower, signature, proof);
        ({ lienId, lien } = await txn.wait().then(receipt => extractBorrowLog(receipt!)));

        expect(await testErc721.ownerOf(tokenId)).to.equal(kettle);
        expect(await receipt.ownerOf(lienId)).to.equal(lender);

        borrowerBalance_before = await testErc20.balanceOf(borrower);
        lenderBalance_before = await testErc20.balanceOf(lender);
        recipientBalance_before = await testErc20.balanceOf(recipient);
      })
    
      it("should repay loan early", async () => {
        await time.increase(HALF_MONTH_SECONDS);

        // get current debt amount
        const { debt, feeInterest, lenderInterest } = await kettle.currentDebtAmount(lien);

        // repay loan
        const txn = await kettle.connect(borrower).repay(lienId, lien);
        const repayLog = await txn.wait().then(receipt => extractRepayLog(receipt!));

        // check logs
        expect(repayLog.lienId).to.equal(lienId);
        expect(repayLog.principal).to.equal(lien.principal);

        expect(repayLog.debt).to.be.within(debt, debt + 100n);
        expect(repayLog.fee).to.be.within(feeInterest, feeInterest + 100n);
        expect(repayLog.interest).to.be.within(lenderInterest, lenderInterest + 100n);

        // check state
        expect(await testErc721.ownerOf(tokenId)).to.equal(borrower);
        expect(await testErc20.balanceOf(borrower)).to.equal(borrowerBalance_before - repayLog.debt);
        expect(await testErc20.balanceOf(lender)).to.equal(lenderBalance_before + repayLog.principal + repayLog.interest);
        expect(await testErc20.balanceOf(recipient)).to.equal(recipientBalance_before + repayLog.fee);
      });
    
      it("should repay loan late (before grace period)", async () => {
        await time.increase(MONTH_SECONDS + HALF_MONTH_SECONDS);
        
        // get current debt amount
        const { debt, feeInterest, lenderInterest } = await kettle.currentDebtAmount(lien);

        // repay loan late
        let txn = await kettle.connect(borrower).repay(lienId, lien);
        const repayLog = await txn.wait().then(receipt => extractRepayLog(receipt!));
    
        // check logs
        expect(repayLog.lienId).to.equal(lienId);
        expect(repayLog.principal).to.equal(lien.principal);

        expect(repayLog.debt).to.be.within(debt, debt + 100n);
        expect(repayLog.fee).to.be.within(feeInterest, feeInterest + 100n);
        expect(repayLog.interest).to.be.within(lenderInterest, lenderInterest + 100n);

        // check state
        expect(await testErc721.ownerOf(tokenId)).to.equal(borrower);
        expect(await testErc20.balanceOf(borrower)).to.equal(borrowerBalance_before - repayLog.debt);
        expect(await testErc20.balanceOf(lender)).to.equal(lenderBalance_before + repayLog.principal + repayLog.interest);
        expect(await testErc20.balanceOf(recipient)).to.equal(recipientBalance_before + repayLog.fee);
      });

      it("should fail to repay loan late (after grace period)", async () => {
        await time.increase(MONTH_SECONDS + MONTH_SECONDS);

        await expect(kettle.connect(borrower).repay(lienId, lien)).to.be.revertedWithCustomError(kettle, "LienDefaulted");

        await kettle.connect(lender).claim(lienId, lien);
        expect(await testErc721.ownerOf(tokenId)).to.equal(lender);
      });
    });
  }
});
