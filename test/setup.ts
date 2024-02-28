import { ethers, upgrades } from "hardhat";
import { Signer, parseUnits } from "ethers";
import { MaxUint256 } from "@ethersproject/constants";

import {
  TestERC20,
  TestERC721,
  Kettle
} from "../typechain-types";

export interface Fixture {
  owner: Signer,
  borrower: Signer,
  lender: Signer,
  lender2: Signer,
  offerMaker: Signer,
  recipient: Signer,
  signers: Signer[],
  kettle: Kettle,
  testErc20: TestERC20,
  testErc721: TestERC721,
  tokens: number[],
  tokenId: number,
  principal: bigint
}

export async function getFixture(): Promise<Fixture> {
  const [owner, borrower, lender, lender2, recipient, offerMaker, ...signers] = await ethers.getSigners();

  /* Deploy Helpers */
  const Distributions = await ethers.getContractFactory("Distributions");
  const distributions = await Distributions.deploy();

  /* Deploy Models */
  const fixedModel = await ethers.getContractFactory("FixedInterest");
  const fixedInterest = await fixedModel.deploy();

  /* Deploy Collateral Verifier */
  const transfer = await ethers.deployContract("Transfer");
  await transfer.waitForDeployment();

  /* Deploy Kettle */
  await upgrades.silenceWarnings();
  const Kettle = await ethers.getContractFactory("Kettle", { libraries: { FixedInterest: fixedInterest.target, Transfer: transfer.target, Distributions: distributions.target } });
  const kettle = await upgrades.deployProxy(Kettle, [], { 
    initializer: 'initialize',
    unsafeAllow: ['external-library-linking'],
  });

  await kettle.waitForDeployment();

  /* Deploy TestERC20 */
  const testErc20 = await ethers.deployContract("TestERC20");
  await testErc20.waitForDeployment();

  /* Deploy TestERC721 */
  const testErc721 = await ethers.deployContract("TestERC721");
  await testErc721.waitForDeployment();

  // mint token to borrower
  const tokenId = 1;
  await testErc721.mint(borrower, 1);
  await testErc721.connect(borrower).setApprovalForAll(kettle, true);

  const principal = parseUnits("10000", 6);
  await testErc20.mint(lender, principal * 10n);
  await testErc20.connect(lender).approve(kettle, MaxUint256.toString());

  await testErc20.mint(lender2, principal * 10n);
  await testErc20.connect(lender2).approve(kettle, MaxUint256.toString());

  await testErc20.mint(borrower, principal * 10n);
  await testErc20.connect(borrower).approve(kettle, MaxUint256.toString());

  await testErc20.mint(offerMaker, principal * 10n);
  await testErc20.connect(offerMaker).approve(kettle, MaxUint256.toString());

  return {
    owner,
    borrower,
    lender,
    lender2,
    offerMaker,
    recipient,
    signers,
    kettle,
    testErc20,
    testErc721,
    tokens: [tokenId, tokenId + 1, tokenId + 2, tokenId + 3, tokenId + 4, tokenId + 5],
    tokenId,
    principal
  }
}
