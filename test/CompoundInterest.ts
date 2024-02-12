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

describe("Compound Interest", function () {

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
      model: 1,
      defaultPeriod: MONTH_SECONDS,
      defaultRate: "2200",
    }

    const txn = await kettle.connect(borrower).borrow(offer, principal, 1, borrower, []);
    ({ lienId, lien } = await txn.wait().then(receipt => extractBorrowLog(receipt!)));
  })

  it("should make interest payment", async () => {
    await time.increaseTo(BigInt(lien.startTime) + BigInt(lien.period));

    const status = await kettle.lienStatus(lien);
    expect(status).to.equal(0);

    const txn = await kettle.connect(borrower).interestPayment(
      lienId, 
      lien
    );

    const paymentLog = await txn.wait().then(receipt => extractPaymentLog(receipt!));
    expect(paymentLog.amountOwed).to.be.within(lien.principal, BigInt(lien.principal) + 9n);
  });

  it("should make pay interest and some principal", async () => {
    await time.increaseTo(BigInt(lien.startTime) + BigInt(lien.period));

    const status = await kettle.lienStatus(lien);
    expect(status).to.equal(0);

    const [amountOwed,,] = await kettle.amountOwed(lien);

    const txn = await kettle.connect(borrower).payment(
      lienId, 
      amountOwed / 2n,
      lien
    );

    const paymentLog = await txn.wait().then(receipt => extractPaymentLog(receipt!));
    expect(paymentLog.amountOwed).to.be.within(amountOwed / 2n, amountOwed / 2n + 99n);
  });

  it("should make interest payment in default", async () => {
    await time.increaseTo(BigInt(lien.startTime) + (BigInt(lien.period) * 3n / 2n));

    const status = await kettle.lienStatus(lien);
    expect(status).to.equal(1);

    const txn = await kettle.connect(borrower).interestPayment(
      lienId, 
      lien
    );

    const paymentLog = await txn.wait().then(receipt => extractPaymentLog(receipt!));
    expect(paymentLog.amountOwed).to.equal(lien.principal);
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
    await time.increaseTo(BigInt(lien.startTime) + (BigInt(lien.period)));

    const [amountOwed,,] = await kettle.amountOwed(lien);
    await testErc20.mint(borrower, amountOwed);

    const txn = await kettle.connect(borrower).repay(
      lienId, 
      lien
    );

    const repayLog = await txn.wait().then(receipt => extractRepayLog(receipt!));
    expect(repayLog.amountOwed).to.be.within(amountOwed, amountOwed + 9999n)
  });

  it('should repay lien after tenor', async () => {
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
    expect(repayLog.amountOwed).to.be.within(amountOwed, amountOwed + 9999n)
  });
});
