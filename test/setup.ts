import { ethers } from "hardhat";
import { Signer, parseUnits } from "ethers";
import { MaxUint256 } from "@ethersproject/constants";

import {
  TestERC20,
  TestERC721,
  Kettle,
  Model,
  Transfer
} from "../typechain-types";

export interface Fixture {
  owner: Signer,
  borrower: Signer,
  lender: Signer,
  recipient: Signer,
  signers: Signer[],
  kettle: Kettle,
  model: Model,
  transfer: Transfer,
  testErc20: TestERC20,
  testErc721: TestERC721,
  tokenId: number,
  principal: bigint
}

export async function getFixture(): Promise<Fixture> {
  const [owner, borrower, lender, recipient, ...signers] = await ethers.getSigners();

  /* Deploy Models */
  const fixedModel = await ethers.getContractFactory("FixedInterest");
  const fixedInterest = await fixedModel.deploy();

  const compoundModel = await ethers.getContractFactory("CompoundInterest");
  const compoundInterest = await compoundModel.deploy();

  const proRatedFixedModel = await ethers.getContractFactory("ProRatedFixedInterest");
  const proRatedFixedInterest = await proRatedFixedModel.deploy();

  /* Deploy Helpers */
  const model = await ethers.deployContract("Model", {
    libraries: { FixedInterest: fixedInterest.target, CompoundInterest: compoundInterest.target, ProRatedFixedInterest: proRatedFixedInterest.target },
    gasLimit: 1e8
  });
  await model.waitForDeployment();

  /* Deploy Collateral Verifier */
  const transfer = await ethers.deployContract("Transfer");
  await transfer.waitForDeployment();

  /* Deploy Kettle */
  const kettle = await ethers.deployContract("Kettle", { 
    libraries: { Model: model.target, Transfer: transfer.target },
    gasLimit: 1e8 
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
  await testErc20.mint(lender, principal);
  await testErc20.connect(lender).approve(kettle, MaxUint256.toString());
  await testErc20.connect(borrower).approve(kettle, MaxUint256.toString());

  return {
    owner,
    borrower,
    lender,
    recipient,
    signers,
    kettle,
    model,
    transfer,
    testErc20,
    testErc721,
    tokenId,
    principal
  }
}
