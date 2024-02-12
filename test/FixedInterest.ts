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
      model: 0,
      defaultPeriod: MONTH_SECONDS,
      defaultRate: "2200",
    }

    const txn = await kettle.connect(borrower).borrow(offer, principal, 1, borrower, []);
    ({ lienId, lien } = await txn.wait().then(receipt => extractBorrowLog(receipt!)));
  })

  it.only("should make interest payment and be current until next payment", async () => {
    await time.increaseTo(BigInt(lien.startTime) + BigInt(lien.period) / 2n);

    console.log(lien);
    console.log(await kettle.states(lienId));

    const status = await kettle.lienStatus(lienId, lien);
    expect(status).to.equal(0);

    const txn = await kettle.connect(borrower).interestPayment(
      lienId, 
      lien
    );

    console.log(await kettle.states(lienId));

    const paymentLog = await txn.wait().then(receipt => extractPaymentLog(receipt!));
    expect(paymentLog.amountOwed).to.be.within(lien.principal, BigInt(lien.principal) + 9n);

    expect(await kettle.nextPaymentDate(lienId, lien)).to.equal(BigInt(lien.startTime) + BigInt(lien.period) * 2n);
    expect(await kettle.amountOwed(lienId, lien).then(({ amount }) => amount)).to.equal(lien.principal); 
  });

  it("should make interest, attemp additional interest payment, and still be paid through same period", async () => {
    await time.increaseTo(BigInt(lien.startTime) + BigInt(lien.period) / 2n);

    const status = await kettle.lienStatus(lien);
    expect(status).to.equal(0);

    const initialAmountOwed = await kettle.amountOwed(lien).then(({ amount }) => amount);

    let txn = await kettle.connect(borrower).interestPayment(
      lienId, 
      lien
    );

    const paymentLog1 = await txn.wait().then(receipt => extractPaymentLog(receipt!));
    expect(paymentLog1.amountOwed).to.be.within(lien.principal, BigInt(lien.principal) + 9n);

    lien.state = {
      paidThrough: paymentLog1.paidThrough,
      amountOwed: paymentLog1.amountOwed
    }

    expect(await kettle.nextPaymentDate(lien)).to.equal(BigInt(lien.startTime) + BigInt(lien.period) * 2n);
    expect(await kettle.amountOwed(lien).then(({ amount }) => amount)).to.equal(lien.principal); 

    txn = await kettle.connect(borrower).interestPayment(
      lienId, 
      lien
    );
    const paymentLog2 = await txn.wait().then(receipt => extractPaymentLog(receipt!));
    expect(paymentLog2.paidThrough).to.equal(paymentLog1.paidThrough);
    expect(await kettle.amountOwed(lien).then(({ amount }) => amount)).to.equal(lien.principal); 

    await time.increaseTo(BigInt(lien.startTime) + BigInt(lien.period) * 3n / 2n);
    await kettle.amountOwed(lien).then(({ amount }) => amount).then(
      (amount) => expect(amount).to.equal(initialAmountOwed)
    );
  });

  it("should pay interest and some principal and be current until next payment", async () => {
    await time.increaseTo(BigInt(lien.startTime) + BigInt(lien.period) / 2n);

    const status = await kettle.lienStatus(lien);
    expect(status).to.equal(0);

    const [, feeInterest, lenderInterest] = await kettle.amountOwed(lien);

    const txn = await kettle.connect(borrower).payment(
      lienId, 
      (BigInt(lien.principal) / 2n) + feeInterest + lenderInterest,
      lien
    );

    const paymentLog = await txn.wait().then(receipt => extractPaymentLog(receipt!));
    expect(paymentLog.amountOwed).to.be.within(BigInt(lien.principal) / 2n, BigInt(lien.principal) / 2n + 9n);

    lien.state = {
      paidThrough: paymentLog.paidThrough,
      amountOwed: paymentLog.amountOwed
    }

    expect(await kettle.nextPaymentDate(lien)).to.equal(BigInt(lien.startTime) + BigInt(lien.period) * 2n);
    expect(await kettle.amountOwed(lien).then(({ amount }) => amount)).to.equal(BigInt(lien.principal) / 2n); 
  });

  it("should make interest payment in default and be current through two periods", async () => {
    await time.increaseTo(BigInt(lien.startTime) + (BigInt(lien.period) * 3n / 2n));

    const status = await kettle.lienStatus(lien);
    expect(status).to.equal(1);

    const txn = await kettle.connect(borrower).interestPayment(
      lienId, 
      lien
    );

    const paymentLog = await txn.wait().then(receipt => extractPaymentLog(receipt!));
    expect(paymentLog.amountOwed).to.be.within(lien.principal, BigInt(lien.principal) + 9n);

    lien.state = {
      paidThrough: paymentLog.paidThrough,
      amountOwed: paymentLog.amountOwed
    }

    expect(await kettle.nextPaymentDate(lien)).to.equal(BigInt(lien.startTime) + BigInt(lien.period) * 3n);
    expect(await kettle.amountOwed(lien).then(({ amount }) => amount)).to.equal(lien.principal); 
  });

  it("should fail to make interest payment after default period", async () => {
    await time.increaseTo(BigInt(lien.startTime) + (BigInt(lien.period) * 3n));

    const status = await kettle.lienStatus(lien);
    expect(status).to.equal(2);

    await expect(kettle.connect(borrower).interestPayment(
      lienId, 
      lien
    )).to.be.revertedWithCustomError(kettle, "LienDefaulted");
  });

  it('should repay lien before tenor', async () => {
    await time.increaseTo(BigInt(lien.startTime) + (BigInt(lien.period) / 2n));

    const [amountOwed,,] = await kettle.amountOwed(lien);
    await testErc20.mint(borrower, amountOwed);

    const txn = await kettle.connect(borrower).repay(
      lienId, 
      lien
    );

    const repayLog = await txn.wait().then(receipt => extractRepayLog(receipt!));
    expect(repayLog.amountOwed).to.be.within(amountOwed, amountOwed + 9999n)
  });

  it.skip('should repay lien after tenor', async () => {
    for (let i = 0; i < 11; i++) {
      await time.increase(BigInt(lien.period));
      const txn = await kettle.connect(borrower).interestPayment(
        lienId, 
        lien
      );

      const paymentLog = await txn.wait().then(receipt => extractPaymentLog(receipt!));
      lien.state = {
        paidThrough: paymentLog.paidThrough,
        amountOwed: paymentLog.amountOwed
      }
    }

    await time.increase(BigInt(lien.period) * 3n / 2n);
    expect(await time.latest()).to.be.above(BigInt(lien.startTime) + BigInt(lien.tenor))

    const [amountOwed,,] = await kettle.amountOwed(lien);
    await testErc20.mint(borrower, amountOwed);

    const state = await kettle.lienStatus(lien);
    expect(state).to.equal(1);

    const txn = await kettle.connect(borrower).repay(
      lienId, 
      lien
    );

    const repayLog = await txn.wait().then(receipt => extractRepayLog(receipt!));
    console.log(repayLog)
    expect(await kettle.amountOwed(lien).then(({ amount }) => amount)).to.equal(lien.principal); 
  });
});
