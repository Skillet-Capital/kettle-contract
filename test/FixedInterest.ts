import {
  time,
  loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer, parseUnits } from "ethers";

import { getFixture } from './setup';
import { extractBorrowLog, extractPaymentLog, extractRepayLog } from './helpers/events';

import {
  TestERC20,
  TestERC721,
  Kettle
} from "../typechain-types";
import { LienStruct } from "../typechain-types/contracts/Kettle";

const DAY_SECONDS = 86400;
const MONTH_SECONDS = DAY_SECONDS * 365 / 12;
const HALF_MONTH_SECONDS = MONTH_SECONDS / 2;

describe("Fixed Interest", function () {

  let owner: Signer;
  let borrower: Signer;
  let lender: Signer;
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
    ({ lienId, lien } = await txn.wait().then(receipt => extractBorrowLog(receipt!)));
  })

  it.only("should make interest payment and be current until next payment", async () => {
    await time.increaseTo(BigInt(lien.startTime) + BigInt(HALF_MONTH_SECONDS));

    const status = await kettle.lienStatus(lien);
    expect(status).to.equal(0);

    const txn = await kettle.connect(borrower).interestPayment(
      lienId, 
      lien
    );

    const paymentLog = await txn.wait().then(receipt => extractPaymentLog(receipt!));
    expect(paymentLog).to.deep.equal({
      lienId,
      pastInterest: 0n,
      pastFee: 0n,
      currentInterest: 83333333n,
      currentFee: 16666666n,
      principal: 0n,
      amountOwed: lien.principal,
      paidThrough: BigInt(lien.startTime) + BigInt(lien.period)
    });

    lien.state = {
      paidThrough: paymentLog.paidThrough,
      amountOwed: paymentLog.amountOwed
    }

    expect(await kettle.nextPaymentDate(lien)).to.equal(BigInt(lien.startTime) + BigInt(lien.period) * 2n);
    expect(await kettle.amountOwed(lien).then(({ amountOwed }) => amountOwed)).to.equal(lien.principal); 

    expect(await kettle.amountOwed(lien)).to.deep.equal([
      lien.principal,
      0n,
      0n,
      0n,
      0n
    ])
  });

  it.only("should make interest, attemp additional interest payment, and still be paid through same period", async () => {
    await time.increaseTo(BigInt(lien.startTime) + BigInt(lien.period) / 2n);

    const status = await kettle.lienStatus(lien);
    expect(status).to.equal(0);

    const initialAmountOwed = await kettle.amountOwed(lien);

    let txn = await kettle.connect(borrower).interestPayment(
      lienId,
      lien
    );

    const paymentLog1 = await txn.wait().then(receipt => extractPaymentLog(receipt!));
    expect(paymentLog1).to.deep.equal({
      lienId,
      pastInterest: 0n,
      pastFee: 0n,
      currentInterest: 83333333n,
      currentFee: 16666666n,
      principal: 0n,
      amountOwed: lien.principal,
      paidThrough: BigInt(lien.startTime) + BigInt(lien.period)
    });

    lien.state = {
      paidThrough: paymentLog1.paidThrough,
      amountOwed: paymentLog1.amountOwed
    }

    expect(await kettle.nextPaymentDate(lien)).to.equal(BigInt(lien.startTime) + BigInt(lien.period) * 2n);
    expect(await kettle.amountOwed(lien)).to.deep.equal([
      lien.principal,
      0n,
      0n,
      0n,
      0n
    ]);

    // attempt an additional payment in the same period
    txn = await kettle.connect(borrower).interestPayment(
      lienId, 
      lien
    );
    const paymentLog2 = await txn.wait().then(receipt => extractPaymentLog(receipt!));
    expect(paymentLog2).to.deep.equal({
      lienId,
      pastInterest: 0n,
      pastFee: 0n,
      currentInterest: 0n,
      currentFee: 0n,
      principal: 0n,
      amountOwed: lien.principal,
      paidThrough: BigInt(lien.startTime) + BigInt(lien.period)
    });

    lien.state = {
      paidThrough: paymentLog2.paidThrough,
      amountOwed: paymentLog2.amountOwed
    }

    expect(await kettle.nextPaymentDate(lien)).to.equal(BigInt(lien.startTime) + BigInt(lien.period) * 2n);
    expect(await kettle.amountOwed(lien)).to.deep.equal([
      lien.principal,
      0n,
      0n,
      0n,
      0n
    ]);

    // fast forward to next period
    await time.increaseTo(BigInt(lien.startTime) + BigInt(MONTH_SECONDS) + BigInt(HALF_MONTH_SECONDS));
    await kettle.amountOwed(lien).then(
      (amount) => expect(amount).to.deep.equal(initialAmountOwed)
    );
  });

  it.only("should pay interest and some principal and be current until next payment", async () => {
    await time.increaseTo(BigInt(lien.startTime) + BigInt(lien.period) / 2n);

    const status = await kettle.lienStatus(lien);
    expect(status).to.equal(0);

    const txn = await kettle.connect(borrower).principalPayment(
      lienId, 
      (BigInt(lien.principal) / 2n),
      lien
    );

    const paymentLog = await txn.wait().then(receipt => extractPaymentLog(receipt!));
    expect(paymentLog).to.deep.equal({
      lienId,
      pastInterest: 0n,
      pastFee: 0n,
      currentInterest: 83333333n,
      currentFee: 16666666n,
      principal: (BigInt(lien.principal) / 2n),
      amountOwed: (BigInt(lien.principal) / 2n),
      paidThrough: BigInt(lien.startTime) + BigInt(lien.period)
    });

    lien.state = {
      paidThrough: paymentLog.paidThrough,
      amountOwed: paymentLog.amountOwed
    }

    expect(await kettle.nextPaymentDate(lien)).to.equal(BigInt(lien.startTime) + BigInt(lien.period) * 2n);
    expect(await kettle.amountOwed(lien)).to.deep.equal([
      BigInt(lien.principal) / 2n,
      0n,
      0n,
      0n,
      0n
    ]);

    // fast forward to next period
    await time.increaseTo(BigInt(lien.startTime) + BigInt(MONTH_SECONDS) + BigInt(HALF_MONTH_SECONDS));
    expect(await kettle.amountOwed(lien)).to.deep.equal([
      (BigInt(lien.principal) + 83333333n + 16666666n) / 2n,
      0n,
      0n,
      83333333n / 2n,
      16666666n / 2n
    ]);
  });

  it.only("should make cure payment in default and be current through one period", async () => {
    await time.increaseTo(BigInt(lien.startTime) + (BigInt(lien.period) * 3n / 2n));

    const status = await kettle.lienStatus(lien);
    expect(status).to.equal(1);

    const { currentInterest, currentFee } = await kettle.amountOwed(lien);
    expect(await kettle.amountOwed(lien)).to.deep.equal([
      BigInt(lien.principal) + (currentInterest + currentFee) * 2n,
      83333333n,
      16666666n,
      83333333n,
      16666666n
    ]);

    // expect(await kettle.nextPaymentDate(lien)).to.equal(BigInt(lien.startTime) + BigInt(lien.period) + BigInt(lien.gracePeriod));

    const txn = await kettle.connect(borrower).curePayment(
      lienId, 
      lien
    );

    const paymentLog = await txn.wait().then(receipt => extractPaymentLog(receipt!));
    expect(paymentLog).to.deep.equal({
      lienId,
      pastInterest: 83333333n,
      pastFee: 16666666n,
      currentInterest: 0n,
      currentFee: 0n,
      principal: 0n,
      amountOwed: lien.principal,
      paidThrough: BigInt(lien.startTime) + BigInt(lien.period)
    });

    lien.state = {
      paidThrough: paymentLog.paidThrough,
      amountOwed: paymentLog.amountOwed
    }

    expect(await kettle.nextPaymentDate(lien)).to.equal(BigInt(lien.startTime) + BigInt(lien.period) * 2n);
    expect(await kettle.amountOwed(lien).then(({ amountOwed }) => amountOwed)).to.equal(BigInt(lien.principal) + currentInterest + currentFee); 
  });

  it.only("should make interest payment in default and be current through two periods", async () => {
    await time.increaseTo(BigInt(lien.startTime) + (BigInt(lien.period) * 3n / 2n));

    const status = await kettle.lienStatus(lien);
    expect(status).to.equal(1);

    expect(await kettle.nextPaymentDate(lien)).to.equal(BigInt(lien.startTime) + BigInt(lien.period) + BigInt(lien.gracePeriod));

    const txn = await kettle.connect(borrower).interestPayment(
      lienId, 
      lien
    );

    const paymentLog = await txn.wait().then(receipt => extractPaymentLog(receipt!));
    expect(paymentLog).to.deep.equal({
      lienId,
      pastInterest: 83333333n,
      pastFee: 16666666n,
      currentInterest: 83333333n,
      currentFee: 16666666n,
      principal: 0n,
      amountOwed: lien.principal,
      paidThrough: BigInt(lien.startTime) + BigInt(lien.period) * 2n
    });

    lien.state = {
      paidThrough: paymentLog.paidThrough,
      amountOwed: paymentLog.amountOwed
    }

    expect(await kettle.nextPaymentDate(lien)).to.equal(BigInt(lien.startTime) + BigInt(lien.period) * 3n);
    expect(await kettle.amountOwed(lien)).to.deep.equal([
      lien.principal,
      0n,
      0n,
      0n,
      0n
    ]);
  });

  it.only("should fail to make interest payment after default period", async () => {
    await time.increaseTo(BigInt(lien.startTime) + (BigInt(lien.period) * 3n));

    const status = await kettle.lienStatus(lien);
    expect(status).to.equal(2);

    await expect(kettle.connect(borrower).interestPayment(
      lienId, 
      lien
    )).to.be.revertedWithCustomError(kettle, "LienDefaulted");
  });

  it.only("should fail to cure payment after default period", async () => {
    await time.increaseTo(BigInt(lien.startTime) + (BigInt(lien.period) * 3n));

    const status = await kettle.lienStatus(lien);
    expect(status).to.equal(2);

    await expect(kettle.connect(borrower).curePayment(
      lienId, 
      lien
    )).to.be.revertedWithCustomError(kettle, "LienDefaulted");
  });

  it.only('should repay lien before tenor', async () => {
    await time.increaseTo(BigInt(lien.startTime) + (BigInt(lien.period) / 2n));

    const { amountOwed } = await kettle.amountOwed(lien);
    await testErc20.mint(borrower, amountOwed);

    const txn = await kettle.connect(borrower).repay(
      lienId, 
      lien
    );

    const repayLog = await txn.wait().then(receipt => extractRepayLog(receipt!));
    expect(repayLog).to.deep.equal({
      lienId,
      pastInterest: 0,
      pastFee: 0,
      currentInterest: 83333333n,
      currentFee: 16666666n,
      principal: lien.principal,
      amountOwed: amountOwed
    });
  });

  it.only('should repay lien after tenor', async () => {
    for (let i = 0; i < 11; i++) {
      await time.increase(BigInt(HALF_MONTH_SECONDS));
      const txn = await kettle.connect(borrower).interestPayment(
        lienId, 
        lien
      );

      const paymentLog = await txn.wait().then(receipt => extractPaymentLog(receipt!));
      // console.log({
      //   ...paymentLog,
      //   paidThrough: (paymentLog.paidThrough - BigInt(lien.startTime)) / BigInt(MONTH_SECONDS)
      // });

      lien.state = {
        paidThrough: paymentLog.paidThrough,
        amountOwed: paymentLog.amountOwed
      }

      await time.increase(BigInt(HALF_MONTH_SECONDS))
    }

    // before we go past tenor, all interest owed is just the current period
    await kettle.lienStatus(lien).then((state) => expect(state).to.equal(0));
    await kettle.amountOwed(lien).then(
      ({ pastInterest, pastFee, currentInterest, currentFee }) => expect({
        pastInterest,
        pastFee,
        currentInterest,
        currentFee
      }).to.deep.equal({
        pastInterest: 0n,
        pastFee: 0n,
        currentInterest: 83333333n,
        currentFee: 16666666n
      }));
    
    await time.increase(BigInt(lien.period) * 3n / 2n);
    expect(await time.latest()).to.be.above(BigInt(lien.startTime) + BigInt(lien.tenor))

    // after we go past tenor, we owe all past interest, but no more current interest
    await kettle.amountOwed(lien).then(
      ({ pastInterest, pastFee, currentInterest, currentFee }) => expect({
        pastInterest,
        pastFee,
        currentInterest,
        currentFee
      }).to.deep.equal({
        pastInterest: 83333333n,
        pastFee: 16666666n,
        currentInterest: 0n,
        currentFee: 0n
      }));

    const { amountOwed } = await kettle.amountOwed(lien);
    await testErc20.mint(borrower, amountOwed);

    await kettle.lienStatus(lien).then((state) => expect(state).to.equal(1));

    const txn = await kettle.connect(borrower).repay(
      lienId, 
      lien
    );

    const repayLog = await txn.wait().then(receipt => extractRepayLog(receipt!));
    expect(repayLog).to.deep.equal({
      lienId,
      pastInterest: 83333333n,
      pastFee: 16666666n,
      currentInterest: 0n,
      currentFee: 0n,
      principal: lien.principal,
      amountOwed: amountOwed
    });
  });
});
