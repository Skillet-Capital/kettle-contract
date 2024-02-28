import {
  time,
  loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer, parseUnits } from "ethers";

import { getFixture } from './setup';
import { extractBorrowLog, extractRefinanceLog } from './helpers/events';

import {
  TestERC20,
  TestERC721,
  Kettle
} from "../typechain-types";
import { LienStruct, LoanOfferStruct } from "../typechain-types/contracts/Kettle";

const DAY_SECONDS = 86400;
const MONTH_SECONDS = DAY_SECONDS * 365 / 12;
const HALF_MONTH_SECONDS = MONTH_SECONDS / 2;

describe("Refinance", function () {

  let owner: Signer;
  let borrower: Signer;
  let lender: Signer;
  let lender2: Signer;
  let recipient: Signer;

  let signers: Signer[];
  let kettle: Kettle;

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
    signers = fixture.signers;

    kettle = fixture.kettle;

    tokenId = fixture.tokenId;
    testErc721 = fixture.testErc721;

    principal = fixture.principal;
    testErc20 = fixture.testErc20;
  });

  let lienId: string | number | bigint;
  let lien: LienStruct;

  let refinanceOffer: LoanOfferStruct;

  let borrowerBalanceBefore: bigint;
  let recipientBalanceBefore: bigint;
  let lender1BalanceBefore: bigint;
  let lender2BalanceBefore: bigint;

  beforeEach(async () => {
    const offer = {
      lender: lender,
      recipient: recipient,
      currency: testErc20,
      collection: testErc721,
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

    beforeEach(async () => {
      refinanceOffer = {
        lender: lender,
        recipient: recipient,
        currency: testErc20,
        collection: testErc721,
        identifier: tokenId,
        size: 1,
        totalAmount: principal * 2n,
        maxAmount: principal * 2n,
        minAmount: principal * 2n,
        tenor: DAY_SECONDS * 365,
        period: MONTH_SECONDS,
        rate: "1000",
        fee: "200",
        gracePeriod: MONTH_SECONDS
      }
    });

    const txn = await kettle.connect(borrower).borrow(offer, principal, 1, borrower, []);
    ({ lienId, lien } = await txn.wait().then(receipt => extractBorrowLog(receipt!)));

    borrowerBalanceBefore = await testErc20.balanceOf(borrower);
    recipientBalanceBefore = await testErc20.balanceOf(recipient);
    lender1BalanceBefore = await testErc20.balanceOf(lender);
    lender2BalanceBefore = await testErc20.balanceOf(lender2);
  });

  describe("current lien", () => {
    let refinanceOffer: LoanOfferStruct;

    beforeEach(async () => {
      refinanceOffer = {
        lender: lender2,
        recipient: recipient,
        currency: testErc20,
        collection: testErc721,
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
    });

    it("amount > amountOwed", async () => {
      const { principal, currentInterest, currentFee } = await kettle.amountOwed(lien);
      const refinanceAmount = principal * 2n;

      const txn = await kettle.connect(borrower).refinance(
        lienId,
        refinanceAmount,
        lien,
        refinanceOffer,
        []
      );

      // const { refinanceLog, borrowLog: { lienId: newLienId, lien: newLien } } = await txn.wait().then(
      //   (receipt) => ({
      //     refinanceLog: extractRefinanceLog(receipt!),
      //     borrowLog: extractBorrowLog(receipt!)
        
      //   })
      // );

      // console.log(refinanceLog);
      // console.log(newLienId);
      // console.log(newLien);

      expect(await testErc20.balanceOf(borrower)).to.be.within(
        borrowerBalanceBefore + refinanceAmount - principal - currentInterest - currentFee - 1n, 
        borrowerBalanceBefore + refinanceAmount - principal - currentInterest - currentFee + 1n, 
      );
      expect(await testErc20.balanceOf(recipient)).to.equal(recipientBalanceBefore + currentFee);
      expect(await testErc20.balanceOf(lender)).to.equal(lender1BalanceBefore + principal + currentInterest);
      expect(await testErc20.balanceOf(lender2)).to.equal(lender2BalanceBefore - refinanceAmount);
    })

    it("amount > principal + interest", async () => {
      const { principal, currentInterest, currentFee } = await kettle.amountOwed(lien);
      const refinanceAmount = principal + currentInterest + (currentFee / 2n);

      const txn = await kettle.connect(borrower).refinance(
        lienId,
        refinanceAmount,
        lien,
        refinanceOffer,
        []
      );

      expect(await testErc20.balanceOf(borrower)).to.be.within(
        borrowerBalanceBefore - (currentFee / 2n) - 1n, 
        borrowerBalanceBefore - (currentFee / 2n) + 1n
      );
      expect(await testErc20.balanceOf(recipient)).to.equal(recipientBalanceBefore + currentFee);
      expect(await testErc20.balanceOf(lender)).to.equal(lender1BalanceBefore + principal + currentInterest);
      expect(await testErc20.balanceOf(lender2)).to.equal(lender2BalanceBefore - refinanceAmount);
    });

    it("amount > principal", async () => {
      const { principal, currentInterest, currentFee } = await kettle.amountOwed(lien);
      const refinanceAmount = principal + (currentInterest / 2n);

      const txn = await kettle.connect(borrower).refinance(
        lienId,
        refinanceAmount,
        lien,
        refinanceOffer,
        []
      );

      expect(await testErc20.balanceOf(borrower)).to.be.within(
        borrowerBalanceBefore - currentFee - (currentInterest / 2n) - 1n, 
        borrowerBalanceBefore - currentFee - (currentInterest / 2n) + 1n
      );
      expect(await testErc20.balanceOf(recipient)).to.equal(recipientBalanceBefore + currentFee);
      expect(await testErc20.balanceOf(lender)).to.equal(lender1BalanceBefore + principal + currentInterest);
      expect(await testErc20.balanceOf(lender2)).to.equal(lender2BalanceBefore - refinanceAmount);
    });

    it("amount < principal", async () => {
      const { principal, currentInterest, currentFee } = await kettle.amountOwed(lien);
      const refinanceAmount = principal / 2n;

      const txn = await kettle.connect(borrower).refinance(
        lienId,
        refinanceAmount,
        lien,
        refinanceOffer,
        []
      );

      expect(await testErc20.balanceOf(borrower)).to.equal(borrowerBalanceBefore - principal - currentFee - currentInterest + refinanceAmount);
      expect(await testErc20.balanceOf(recipient)).to.equal(recipientBalanceBefore + currentFee);
      expect(await testErc20.balanceOf(lender)).to.equal(lender1BalanceBefore + principal + currentInterest);
      expect(await testErc20.balanceOf(lender2)).to.equal(lender2BalanceBefore - refinanceAmount);
    })
  });

  describe("delinquent lien", () => {
    let refinanceOffer: LoanOfferStruct;

    beforeEach(async () => {
      refinanceOffer = {
        lender: lender2,
        recipient: recipient,
        currency: testErc20,
        collection: testErc721,
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

      await time.increaseTo(BigInt(lien.startTime) + BigInt(lien.period) * 3n / 2n);
    });

    it("amount > amountOwed", async () => {
      const { principal, pastInterest, pastFee, currentInterest, currentFee } = await kettle.amountOwed(lien);
      const refinanceAmount = principal * 2n;

      const txn = await kettle.connect(borrower).refinance(
        lienId,
        refinanceAmount,
        lien,
        refinanceOffer,
        []
      );

      // const { refinanceLog, borrowLog: { lienId: newLienId, lien: newLien } } = await txn.wait().then(
      //   (receipt) => ({
      //     refinanceLog: extractRefinanceLog(receipt!),
      //     borrowLog: extractBorrowLog(receipt!)
        
      //   })
      // );

      // console.log(refinanceLog);
      // console.log(newLienId);
      // console.log(newLien);

      expect(await testErc20.balanceOf(borrower)).to.be.within(
        borrowerBalanceBefore + refinanceAmount - principal - currentInterest - currentFee - pastInterest - pastFee - 1n, 
        borrowerBalanceBefore + refinanceAmount - principal - currentInterest - currentFee - pastInterest - pastFee + 1n, 
      );
      expect(await testErc20.balanceOf(recipient)).to.equal(recipientBalanceBefore + currentFee + pastFee);
      expect(await testErc20.balanceOf(lender)).to.equal(lender1BalanceBefore + principal + currentInterest + pastInterest);
      expect(await testErc20.balanceOf(lender2)).to.equal(lender2BalanceBefore - refinanceAmount);
    })

    it("amount > principal + interest", async () => {
      const { principal, pastInterest, pastFee, currentInterest, currentFee } = await kettle.amountOwed(lien);
      const refinanceAmount = principal + currentInterest + pastInterest + pastFee + (currentFee / 2n);

      const txn = await kettle.connect(borrower).refinance(
        lienId,
        refinanceAmount,
        lien,
        refinanceOffer,
        []
      );

      expect(await testErc20.balanceOf(borrower)).to.be.within(
        borrowerBalanceBefore - (currentFee / 2n) - 1n, 
        borrowerBalanceBefore - (currentFee / 2n) + 1n
      );
      expect(await testErc20.balanceOf(recipient)).to.equal(recipientBalanceBefore + currentFee + pastFee);
      expect(await testErc20.balanceOf(lender)).to.equal(lender1BalanceBefore + principal + currentInterest + pastInterest);
      expect(await testErc20.balanceOf(lender2)).to.equal(lender2BalanceBefore - refinanceAmount);
    });

    it("amount > principal", async () => {
      const { principal, pastInterest, pastFee, currentInterest, currentFee } = await kettle.amountOwed(lien);
      const refinanceAmount = principal + pastInterest + (currentInterest / 2n);

      const txn = await kettle.connect(borrower).refinance(
        lienId,
        refinanceAmount,
        lien,
        refinanceOffer,
        []
      );

      expect(await testErc20.balanceOf(borrower)).to.be.within(
        borrowerBalanceBefore - currentFee - pastFee - (currentInterest / 2n) - 1n, 
        borrowerBalanceBefore - currentFee - pastFee - (currentInterest / 2n) + 1n
      );
      expect(await testErc20.balanceOf(recipient)).to.equal(recipientBalanceBefore + currentFee + pastFee);
      expect(await testErc20.balanceOf(lender)).to.equal(lender1BalanceBefore + principal + currentInterest + pastInterest);
      expect(await testErc20.balanceOf(lender2)).to.equal(lender2BalanceBefore - refinanceAmount);
    });

    it("amount < principal", async () => {
      const { principal, pastInterest, pastFee, currentInterest, currentFee } = await kettle.amountOwed(lien);
      const refinanceAmount = principal / 2n;

      const txn = await kettle.connect(borrower).refinance(
        lienId,
        refinanceAmount,
        lien,
        refinanceOffer,
        []
      );

      expect(await testErc20.balanceOf(borrower)).to.equal(
        borrowerBalanceBefore - (principal / 2n) - currentInterest - currentFee - pastInterest - pastFee
      );

      expect(await testErc20.balanceOf(recipient)).to.equal(recipientBalanceBefore + currentFee + pastFee);
      expect(await testErc20.balanceOf(lender)).to.equal(lender1BalanceBefore + principal + currentInterest + pastInterest);
      expect(await testErc20.balanceOf(lender2)).to.equal(lender2BalanceBefore - refinanceAmount);
    })
  });
});
