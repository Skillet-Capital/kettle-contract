import { time } from "@nomicfoundation/hardhat-toolbox/network-helpers";

import { expect } from "chai";
import { Signer, parseUnits } from "ethers";

import { getFixture } from './setup';

import {
  TestERC20,
  TestERC721,
  Kettle
} from "../typechain-types";
import { LienStruct } from "../typechain-types/contracts/Kettle";

const DAY_SECONDS = 86400;
const MONTH_SECONDS = BigInt(DAY_SECONDS * 365 / 12);
const YEAR_SECONDS = BigInt(DAY_SECONDS * 365);

describe("LienStatus", function () {
  let kettle: Kettle;
  let signers: Signer[];
  let testErc20: TestERC20;
  let testErc721: TestERC721;

  beforeEach(async () => {
    const fixture = await getFixture();
    kettle = fixture.kettle;
    signers = fixture.signers;
    testErc20 = fixture.testErc20;
    testErc721 = fixture.testErc721;
  });

  let lien: LienStruct;
  
  let lender: Signer;
  let borrower: Signer;
  let recipient: Signer;
  
  let principal: bigint;
  let rate: bigint;
  let defaultRate: bigint;
  let fee: bigint;

  let duration: bigint;
  let gracePeriod: bigint;

  let startTime: bigint;

  describe("Current Debt Amount", () => {
    beforeEach(async () => {
      [lender, borrower, recipient] = signers;
  
      principal = parseUnits("1000", 6);
      rate = 1000n;
      defaultRate = 2000n;
      fee = 200n;

      duration = YEAR_SECONDS;
      gracePeriod = MONTH_SECONDS;

      startTime = await time.latest().then((t) => BigInt(t));
  
      lien = {
        borrower,
        recipient,
        currency: testErc20,
        collection: testErc721,
        itemType: 0,
        tokenId: 1,
        size: 1,
        principal,
        rate,
        defaultRate,
        fee,
        duration,
        gracePeriod,
        startTime
      }
    });

    it("r=0%, f=0%, d=0%", async () => {
      await time.increase(YEAR_SECONDS / 2n);

      lien.principal = 1000000000n;
      lien.rate = 0n;
      lien.fee = 0n;
      lien.defaultRate = 0n;

      let { debt, fee, interest } = await kettle.currentDebtAmount(lien);
      
      expect(debt).to.equal(1000000000);
      expect(fee).to.equal(0);
      expect(interest).to.equal(0);

      await time.increase(YEAR_SECONDS / 2n + MONTH_SECONDS);
      ({ debt, fee, interest } = await kettle.currentDebtAmount(lien))

      expect(debt).to.equal(1000000000);
      expect(fee).to.equal(0);
      expect(interest).to.equal(0);
    });

    it("r=0%, f=2%, d=20%", async () => {
      await time.increase(YEAR_SECONDS / 2n);

      lien.principal = 1000000000n;
      lien.rate = 0n;
      lien.fee = 200n;
      lien.defaultRate = 2000n;

      let { debt, fee, interest } = await kettle.currentDebtAmount(lien);
      expect(debt).to.equal(1010050167n);
      expect(fee).to.equal(10050167n);
      expect(interest).to.equal(0);

      await time.increase(YEAR_SECONDS / 2n);
      ({ debt, fee, interest } = await kettle.currentDebtAmount(lien));
      expect(debt).to.equal(1020201340n);
      expect(fee).to.equal(20201340n);
      expect(interest).to.equal(0n);

      await time.increase(MONTH_SECONDS);
      ({ debt, fee, interest } = await kettle.currentDebtAmount(lien));
      expect(debt).to.equal(1038709423n);
      expect(fee).to.equal(21903093n);
      expect(interest).to.equal(16806330n);
    })

    it("r=10%, f=0%, d=0%", async () => {
      await time.increase(YEAR_SECONDS / 2n);

      lien.principal = 1000000000n;
      lien.rate = 1000n;
      lien.fee = 0n;
      lien.defaultRate = 0n;

      let { debt, fee, interest } = await kettle.currentDebtAmount(lien);
      expect(debt).to.equal(1051271096n);
      expect(fee).to.equal(0n);
      expect(interest).to.equal(51271096n);

      await time.increase(YEAR_SECONDS / 2n);
      ({ debt, fee, interest } = await kettle.currentDebtAmount(lien));
      expect(debt).to.equal(1105170918n);
      expect(fee).to.equal(0n);
      expect(interest).to.equal(105170918n);

      await time.increase(MONTH_SECONDS);
      ({ debt, fee, interest } = await kettle.currentDebtAmount(lien));
      expect(debt).to.equal(1105170918n);
      expect(fee).to.equal(0n);
      expect(interest).to.equal(105170918n);
    })

    it("r=10%, f=2%, d=20%", async () => {
      await time.increase(YEAR_SECONDS / 2n);

      lien.principal = 1000000000n;
      lien.rate = 1000n;
      lien.fee = 200n;
      lien.defaultRate = 2000n;

      let { debt, fee, interest } = await kettle.currentDebtAmount(lien);
      
      expect(debt).to.equal(1061321263);
      expect(fee).to.equal(10050167);
      expect(interest).to.equal(51271096);

      await time.increase(YEAR_SECONDS / 2n);
      ({ debt, fee, interest } = await kettle.currentDebtAmount(lien));

      expect(debt).to.equal(1125372258);
      expect(fee).to.equal(20201340n);
      expect(interest).to.equal(105170918n);

      await time.increase(MONTH_SECONDS);
      ({ debt, fee, interest } = await kettle.currentDebtAmount(lien));
      expect(debt).to.equal(1145647878n);
      expect(fee).to.equal(21903093n);
      expect(interest).to.equal(123744785n);
    })
  });
});
