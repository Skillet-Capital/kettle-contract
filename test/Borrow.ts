import { time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { Signer } from "ethers";

import { getFixture } from './setup';
import { signBorrowOffer } from "./helpers/signatures";
import { extractBorrowLog } from './helpers/events';
import { randomBytes } from './helpers/merkle';

import {
  TestERC20,
  TestERC721,
  Kettle,
  LenderReceipt
} from "../typechain-types";

import { 
  LienStruct, 
  CollateralStruct, 
  FeeTermsStruct, 
  BorrowOfferTermsStruct 
} from "../typechain-types/contracts/Kettle";

const DAY_SECONDS = 86400;
const MONTH_SECONDS = DAY_SECONDS * 365 / 12;

describe("Borrow", function () {

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

  let lienId: string | number | bigint;
  let lien: LienStruct;

  let terms: BorrowOfferTermsStruct;
  let collateral: CollateralStruct;
  let fee: FeeTermsStruct;

  beforeEach(async () => {
    fee = {
      recipient,
      rate: "200"
    }

    terms = {
      currency: testErc20,
      amount: principal,
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
  });

  it("should loan to borrow offer", async () => {
    const borrowOffer = {
      borrower,
      terms,
      collateral,
      fee,
      salt: randomBytes(),
      expiration: await time.latest() + DAY_SECONDS
    }

    const signature = await signBorrowOffer(kettle, borrower, borrowOffer);

    const txn = await kettle.connect(lender).loan(borrowOffer, signature);
    ({ lienId, lien } = await txn.wait().then(receipt => extractBorrowLog(receipt!)));

    expect(await receipt.ownerOf(lienId)).to.equal(lender);
    expect(lien.borrower).to.equal(borrower);
    expect(lien.recipient).to.equal(recipient);
    expect(lien.currency).to.equal(testErc20);
    expect(lien.collection).to.equal(testErc721);
    expect(lien.tokenId).to.equal(tokenId);
    expect(lien.size).to.equal(1);
    expect(lien.principal).to.equal(principal);
    expect(lien.rate).to.equal(terms.rate);
    expect(lien.defaultRate).to.equal(terms.defaultRate);
    expect(lien.fee).to.equal(fee.rate);
    expect(lien.duration).to.equal(terms.duration);
    expect(lien.gracePeriod).to.equal(terms.gracePeriod);
  })
});
