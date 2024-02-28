import {
  time,
  loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer, parseUnits } from "ethers";

import { getFixture } from './setup';
import { extractBorrowLog, extractBuyInLienWithLoanLog } from './helpers/events';

import {
  TestERC20,
  TestERC721,
  Kettle
} from "../typechain-types";
import { LienStruct, LoanOfferStruct, MarketOfferStruct } from "../typechain-types/contracts/Kettle";

const DAY_SECONDS = 86400;
const MONTH_SECONDS = DAY_SECONDS * 365 / 12;
const HALF_MONTH_SECONDS = MONTH_SECONDS / 2;

describe("Buy In Lien With Loan", function () {

  let owner: Signer;
  let borrower: Signer;
  let lender: Signer;
  let lender2: Signer;
  let buyer: Signer;
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
    buyer = fixture.offerMaker;
    recipient = fixture.recipient;
    signers = fixture.signers;

    kettle = fixture.kettle;

    testErc721 = fixture.testErc721;

    tokenId = fixture.tokenId;
    principal = fixture.principal;
    testErc20 = fixture.testErc20;
  });

  let lienId: string | number | bigint;
  let lien: LienStruct;

  let loanOffer: LoanOfferStruct;
  let askOffer: MarketOfferStruct;

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

    const txn = await kettle.connect(borrower).borrow(offer, principal, 1, borrower, []);
      ({ lienId, lien } = await txn.wait().then(receipt => extractBorrowLog(receipt!))
    );
  });

  for (var i=0; i<2; i++) {
    const delinquent = i === 1;

    describe(`[${delinquent ? 'DELINQUENT' : 'CURRENT'}] should purchase a listed asset in a lien with a loan offer`, () => {
      let borrowerBalanceBefore: bigint;
      let recipientBalanceBefore: bigint;
      let lenderBalanceBefore: bigint;
      let lender2BalanceBefore: bigint;
      let bidderBalanceBefore: bigint;
  
      beforeEach(async () => {
        if (delinquent) {
          await time.increase(MONTH_SECONDS + HALF_MONTH_SECONDS);
        }

        expect(await testErc721.ownerOf(tokenId)).to.eq(kettle);
        borrowerBalanceBefore = await testErc20.balanceOf(borrower);
        recipientBalanceBefore = await testErc20.balanceOf(recipient);
        lenderBalanceBefore = await testErc20.balanceOf(lender);
        lender2BalanceBefore = await testErc20.balanceOf(lender2);
        bidderBalanceBefore = await testErc20.balanceOf(buyer);
      });

      it("should revert if ask < owed", async () => {
        const { amountOwed, principal, currentInterest, currentFee, pastFee, pastInterest } = await kettle.amountOwed(lien);
        expect(pastFee).to.equal(!delinquent ? 0n : currentFee);
        expect(pastInterest).to.equal(!delinquent ? 0n : currentInterest);

        askOffer = {
          side: 1,
          maker: borrower,
          currency: testErc20,
          collection: testErc721,
          tokenId: tokenId,
          size: 1,
          amount: amountOwed / 2n,
          withLoan: false,
          borrowAmount: 0
        }
    
        loanOffer = {
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

        await expect(kettle.connect(buyer).buyInLienWithLoan(
          lienId,
          principal,
          lien,
          loanOffer,
          askOffer
        )).to.be.revertedWithCustomError(kettle, "InsufficientAskAmount");
      })

      it("ask > borrow > owed", async () => {
        const { amountOwed, principal, currentInterest, currentFee, pastFee, pastInterest } = await kettle.amountOwed(lien);
        expect(pastFee).to.equal(!delinquent ? 0n : currentFee);
        expect(pastInterest).to.equal(!delinquent ? 0n : currentInterest);

        askOffer = {
          side: 1,
          maker: borrower,
          currency: testErc20,
          collection: testErc721,
          tokenId: tokenId,
          size: 1,
          amount: amountOwed * 2n,
          withLoan: false,
          borrowAmount: 0
        }
    
        loanOffer = {
          lender: lender2,
          recipient: recipient,
          currency: testErc20,
          collection: testErc721,
          identifier: tokenId,
          size: 1,
          totalAmount: amountOwed * 2n,
          maxAmount: amountOwed * 2n,
          minAmount: amountOwed * 2n,
          tenor: DAY_SECONDS * 365,
          period: MONTH_SECONDS,
          rate: "1000",
          fee: "200",
          gracePeriod: MONTH_SECONDS
        }
        
        const borrowAmount = amountOwed * 3n / 2n;
        const txn = await kettle.connect(buyer).buyInLienWithLoan(
          lienId,
          borrowAmount,
          lien,
          loanOffer,
          askOffer
        );
        
        // after checks
        expect(await testErc721.ownerOf(tokenId)).to.equal(kettle);

        expect(await testErc20.balanceOf(buyer)).to.equal(bidderBalanceBefore - (BigInt(askOffer.amount) - borrowAmount));
        expect(await testErc20.balanceOf(borrower)).to.equal(borrowerBalanceBefore + BigInt(askOffer.amount) - amountOwed);
        expect(await testErc20.balanceOf(lender)).to.equal(lenderBalanceBefore + currentInterest + pastInterest + principal);
        expect(await testErc20.balanceOf(lender2)).to.equal(lender2BalanceBefore - borrowAmount);

        // log check
        const { borrowLog, buyInLienWithLoanLog } = await txn.wait().then(receipt => ({
          borrowLog: extractBorrowLog(receipt!),
          buyInLienWithLoanLog: extractBuyInLienWithLoanLog(receipt!)
        }));

        expect(buyInLienWithLoanLog.oldLienId).to.equal(lienId);
        expect(borrowLog.lienId).to.equal(buyInLienWithLoanLog.newLienId);
        expect(borrowLog.lien.borrower).to.equal(buyInLienWithLoanLog.buyer).to.equal(buyer);
        expect(borrowLog.lien.lender).to.equal(loanOffer.lender).to.equal(lender2);
        expect(borrowLog.lien.collection).to.equal(buyInLienWithLoanLog.collection);
        expect(borrowLog.lien.tokenId).to.equal(buyInLienWithLoanLog.tokenId);
        expect(borrowLog.lien.principal).to.equal(buyInLienWithLoanLog.borrowAmount);
        expect(buyInLienWithLoanLog.seller).to.equal(askOffer.maker).to.equal(borrower);
      });

      it("ask > owed > borrowAmount > principal + interest", async () => {
        const { amountOwed, principal, currentInterest, currentFee, pastFee, pastInterest } = await kettle.amountOwed(lien);
        expect(pastFee).to.equal(!delinquent ? 0n : currentFee);
        expect(pastInterest).to.equal(!delinquent ? 0n : currentInterest);

        askOffer = {
          side: 1,
          maker: borrower,
          currency: testErc20,
          collection: testErc721,
          tokenId: tokenId,
          size: 1,
          amount: amountOwed * 2n,
          withLoan: false,
          borrowAmount: 0
        }
    
        loanOffer = {
          lender: lender2,
          recipient: recipient,
          currency: testErc20,
          collection: testErc721,
          identifier: tokenId,
          size: 1,
          totalAmount: amountOwed * 2n,
          maxAmount: amountOwed * 2n,
          minAmount: amountOwed * 2n,
          tenor: DAY_SECONDS * 365,
          period: MONTH_SECONDS,
          rate: "1000",
          fee: "200",
          gracePeriod: MONTH_SECONDS
        }
        
        const borrowAmount = principal + currentInterest + pastInterest + pastFee + (currentFee / 2n);
        expect(borrowAmount).to.be.lt(amountOwed);

        const txn = await kettle.connect(buyer).buyInLienWithLoan(
          lienId,
          borrowAmount,
          lien,
          loanOffer,
          askOffer
        );
        
        // after checks
        expect(await testErc721.ownerOf(tokenId)).to.equal(kettle);

        expect(await testErc20.balanceOf(buyer)).to.equal(bidderBalanceBefore - (BigInt(askOffer.amount) - borrowAmount));
        expect(await testErc20.balanceOf(borrower)).to.equal(borrowerBalanceBefore + BigInt(askOffer.amount) - amountOwed);

        expect(await testErc20.balanceOf(lender)).to.equal(lenderBalanceBefore + currentInterest + pastInterest + principal);
        expect(await testErc20.balanceOf(lender2)).to.equal(lender2BalanceBefore - borrowAmount);

        // log check
        const { borrowLog, buyInLienWithLoanLog } = await txn.wait().then(receipt => ({
          borrowLog: extractBorrowLog(receipt!),
          buyInLienWithLoanLog: extractBuyInLienWithLoanLog(receipt!)
        }));

        expect(buyInLienWithLoanLog.oldLienId).to.equal(lienId);
        expect(borrowLog.lienId).to.equal(buyInLienWithLoanLog.newLienId);
        expect(borrowLog.lien.borrower).to.equal(buyInLienWithLoanLog.buyer).to.equal(buyer);
        expect(borrowLog.lien.lender).to.equal(loanOffer.lender).to.equal(lender2);
        expect(borrowLog.lien.collection).to.equal(buyInLienWithLoanLog.collection);
        expect(borrowLog.lien.tokenId).to.equal(buyInLienWithLoanLog.tokenId);
        expect(borrowLog.lien.principal).to.equal(buyInLienWithLoanLog.borrowAmount);
        expect(buyInLienWithLoanLog.seller).to.equal(askOffer.maker).to.equal(borrower);
      });

      it("ask > owed > principal > borrowAmount", async () => {
        const { amountOwed, principal, currentInterest, currentFee, pastFee, pastInterest } = await kettle.amountOwed(lien);
        expect(pastFee).to.equal(!delinquent ? 0n : currentFee);
        expect(pastInterest).to.equal(!delinquent ? 0n : currentInterest);

        askOffer = {
          side: 1,
          maker: borrower,
          currency: testErc20,
          collection: testErc721,
          tokenId: tokenId,
          size: 1,
          amount: amountOwed * 2n,
          withLoan: false,
          borrowAmount: 0
        }
    
        loanOffer = {
          lender: lender2,
          recipient: recipient,
          currency: testErc20,
          collection: testErc721,
          identifier: tokenId,
          size: 1,
          totalAmount: amountOwed * 2n,
          maxAmount: amountOwed * 2n,
          minAmount: amountOwed * 2n,
          tenor: DAY_SECONDS * 365,
          period: MONTH_SECONDS,
          rate: "1000",
          fee: "200",
          gracePeriod: MONTH_SECONDS
        }
        
        const borrowAmount = principal / 2n;
        expect(borrowAmount).to.be.lt(amountOwed);

        const txn = await kettle.connect(buyer).buyInLienWithLoan(
          lienId,
          borrowAmount,
          lien,
          loanOffer,
          askOffer
        );
        
        // after checks
        expect(await testErc721.ownerOf(tokenId)).to.equal(kettle);

        expect(await testErc20.balanceOf(buyer)).to.equal(bidderBalanceBefore - (BigInt(askOffer.amount) - borrowAmount));
        expect(await testErc20.balanceOf(borrower)).to.equal(borrowerBalanceBefore + BigInt(askOffer.amount) - amountOwed);

        expect(await testErc20.balanceOf(lender)).to.equal(lenderBalanceBefore + currentInterest + pastInterest + principal);
        expect(await testErc20.balanceOf(lender2)).to.equal(lender2BalanceBefore - borrowAmount);

        // log check
        const { borrowLog, buyInLienWithLoanLog } = await txn.wait().then(receipt => ({
          borrowLog: extractBorrowLog(receipt!),
          buyInLienWithLoanLog: extractBuyInLienWithLoanLog(receipt!)
        }));

        expect(buyInLienWithLoanLog.oldLienId).to.equal(lienId);
        expect(borrowLog.lienId).to.equal(buyInLienWithLoanLog.newLienId);
        expect(borrowLog.lien.borrower).to.equal(buyInLienWithLoanLog.buyer).to.equal(buyer);
        expect(borrowLog.lien.lender).to.equal(loanOffer.lender);
        expect(borrowLog.lien.collection).to.equal(buyInLienWithLoanLog.collection);
        expect(borrowLog.lien.tokenId).to.equal(buyInLienWithLoanLog.tokenId);
        expect(borrowLog.lien.principal).to.equal(buyInLienWithLoanLog.borrowAmount);
        expect(buyInLienWithLoanLog.seller).to.equal(askOffer.maker).to.equal(borrower);
      });

      it("ask > owed > borrowAmount > principal", async () => {
        const { amountOwed, principal, currentInterest, currentFee, pastFee, pastInterest } = await kettle.amountOwed(lien);
        expect(pastFee).to.equal(!delinquent ? 0n : currentFee);
        expect(pastInterest).to.equal(!delinquent ? 0n : currentInterest);

        askOffer = {
          side: 1,
          maker: borrower,
          currency: testErc20,
          collection: testErc721,
          tokenId: tokenId,
          size: 1,
          amount: amountOwed * 2n,
          withLoan: false,
          borrowAmount: 0
        }
    
        loanOffer = {
          lender: lender2,
          recipient: recipient,
          currency: testErc20,
          collection: testErc721,
          identifier: tokenId,
          size: 1,
          totalAmount: amountOwed * 2n,
          maxAmount: amountOwed * 2n,
          minAmount: amountOwed * 2n,
          tenor: DAY_SECONDS * 365,
          period: MONTH_SECONDS,
          rate: "1000",
          fee: "200",
          gracePeriod: MONTH_SECONDS
        }
        
        const borrowAmount = principal + (currentInterest / 2n) + pastInterest;
        expect(borrowAmount).to.be.lt(amountOwed);

        const txn = await kettle.connect(buyer).buyInLienWithLoan(
          lienId,
          borrowAmount,
          lien,
          loanOffer,
          askOffer
        );
        
        // after checks
        expect(await testErc721.ownerOf(tokenId)).to.equal(kettle);

        expect(await testErc20.balanceOf(buyer)).to.equal(bidderBalanceBefore - (BigInt(askOffer.amount) - borrowAmount));
        expect(await testErc20.balanceOf(borrower)).to.equal(borrowerBalanceBefore + BigInt(askOffer.amount) - amountOwed);

        expect(await testErc20.balanceOf(lender)).to.equal(lenderBalanceBefore + currentInterest + pastInterest + principal);
        expect(await testErc20.balanceOf(lender2)).to.equal(lender2BalanceBefore - borrowAmount);
        
        // log check
        const { borrowLog, buyInLienWithLoanLog } = await txn.wait().then(receipt => ({
          borrowLog: extractBorrowLog(receipt!),
          buyInLienWithLoanLog: extractBuyInLienWithLoanLog(receipt!)
        }));

        expect(buyInLienWithLoanLog.oldLienId).to.equal(lienId);
        expect(borrowLog.lienId).to.equal(buyInLienWithLoanLog.newLienId);
        expect(borrowLog.lien.borrower).to.equal(buyInLienWithLoanLog.buyer).to.equal(buyer);
        expect(borrowLog.lien.lender).to.equal(loanOffer.lender);
        expect(borrowLog.lien.collection).to.equal(buyInLienWithLoanLog.collection);
        expect(borrowLog.lien.tokenId).to.equal(buyInLienWithLoanLog.tokenId);
        expect(borrowLog.lien.principal).to.equal(buyInLienWithLoanLog.borrowAmount);
        expect(buyInLienWithLoanLog.seller).to.equal(askOffer.maker).to.equal(borrower);
      });
    });
  }

  it("should fail if borrower is not offer maker", async () => {

    askOffer = {
      side: 1,
      maker: lender,
      currency: testErc20,
      collection: testErc721,
      tokenId: tokenId,
      size: 1,
      amount: principal * 3n / 2n,
      withLoan: false,
      borrowAmount: 0
    }

    loanOffer = {
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

    await expect(kettle.connect(buyer).buyInLienWithLoan(
      lienId,
      principal,
      lien,
      loanOffer,
      askOffer
    )).to.be.revertedWithCustomError(kettle, "MakerIsNotBorrower");  
  });

  it("should fail if offer is not ask", async () => {

    askOffer = {
      side: 0,
      maker: borrower,
      currency: testErc20,
      collection: testErc721,
      tokenId: tokenId,
      size: 1,
      amount: principal * 3n / 2n,
      withLoan: false,
      borrowAmount: 0
    }

    loanOffer = {
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

    await expect(kettle.connect(buyer).buyInLienWithLoan(
      lienId,
      principal,
      lien,
      loanOffer,
      askOffer
    )).to.be.revertedWithCustomError(kettle, "OfferNotAsk");    
  });

  it("should fail if collections do not match (ask and lien)", async () => {

    askOffer = {
      side: 1,
      maker: borrower,
      currency: testErc20,
      collection: testErc20, // use different address for mismatch
      tokenId: tokenId,
      size: 1,
      amount: principal * 3n / 2n,
      withLoan: false,
      borrowAmount: 0
    }

    loanOffer = {
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

    await expect(kettle.connect(buyer).buyInLienWithLoan(
      lienId,
      principal,
      lien,
      loanOffer,
      askOffer
    )).to.be.revertedWithCustomError(kettle, "CollectionMismatch");    
  });

  it("should fail if collections do not match (loan offer and lien)", async () => {

    askOffer = {
      side: 1,
      maker: borrower,
      currency: testErc20,
      collection: testErc721,
      tokenId: tokenId,
      size: 1,
      amount: principal * 3n / 2n,
      withLoan: false,
      borrowAmount: 0
    }

    loanOffer = {
      lender: lender2,
      recipient: recipient,
      currency: testErc20,
      collection: testErc20, // use different address for mismatch
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

    await expect(kettle.connect(buyer).buyInLienWithLoan(
      lienId,
      principal,
      lien,
      loanOffer,
      askOffer
    )).to.be.revertedWithCustomError(kettle, "CollectionMismatch");    
  });

  it("should fail if currencies do not match (ask and lien)", async () => {

    askOffer = {
      side: 1,
      maker: borrower,
      currency: testErc721,  // use different address for mismatch
      collection: testErc721,
      tokenId: tokenId,
      size: 1,
      amount: principal * 3n / 2n,
      withLoan: false,
      borrowAmount: 0
    }

    loanOffer = {
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

    await expect(kettle.connect(buyer).buyInLienWithLoan(
      lienId,
      principal,
      lien,
      loanOffer,
      askOffer
    )).to.be.revertedWithCustomError(kettle, "CurrencyMismatch");    
  });

  it("should fail if currencies do not match (loan offer and lien)", async () => {

    askOffer = {
      side: 1,
      maker: borrower,
      currency: testErc20,
      collection: testErc721,
      tokenId: tokenId,
      size: 1,
      amount: principal * 3n / 2n,
      withLoan: false,
      borrowAmount: 0
    }

    loanOffer = {
      lender: lender2,
      recipient: recipient,
      currency: testErc721,   // use different address for mismatch
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

    await expect(kettle.connect(buyer).buyInLienWithLoan(
      lienId,
      principal,
      lien,
      loanOffer,
      askOffer
    )).to.be.revertedWithCustomError(kettle, "CurrencyMismatch");    
  });

  it("should fail if sizes do not match (ask and lien)", async () => {

    askOffer = {
      side: 1,
      maker: borrower,
      currency: testErc20,
      collection: testErc721,
      tokenId: tokenId,
      size: 2,
      amount: principal * 3n / 2n,
      withLoan: false,
      borrowAmount: 0
    }

    loanOffer = {
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

    await expect(kettle.connect(buyer).buyInLienWithLoan(
      lienId,
      principal,
      lien,
      loanOffer,
      askOffer
    )).to.be.revertedWithCustomError(kettle, "SizeMismatch");    
  });

  it("should fail if sizes do not match (loan offer and lien)", async () => {

    askOffer = {
      side: 1,
      maker: borrower,
      currency: testErc20,
      collection: testErc721,
      tokenId: tokenId,
      size: 1,
      amount: principal * 3n / 2n,
      withLoan: false,
      borrowAmount: 0
    }

    loanOffer = {
      lender: lender2,
      recipient: recipient,
      currency: testErc20,
      collection: testErc721,
      identifier: tokenId,
      size: 2,
      totalAmount: principal,
      maxAmount: principal,
      minAmount: principal,
      tenor: DAY_SECONDS * 365,
      period: MONTH_SECONDS,
      rate: "1000",
      fee: "200",
      gracePeriod: MONTH_SECONDS
    }

    await expect(kettle.connect(buyer).buyInLienWithLoan(
      lienId,
      principal,
      lien,
      loanOffer,
      askOffer
    )).to.be.revertedWithCustomError(kettle, "SizeMismatch");    
  });
});
