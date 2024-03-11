import { ethers } from "hardhat";

async function main() {
  const [owner] = await ethers.getSigners();
  console.log(await owner.provider.getBalance(owner));

  /* Deploy Helpers */
  const Distributions = await ethers.getContractFactory("Distributions");
  const distributions = await Distributions.deploy();

  /* Deploy Models */
  const fixedModel = await ethers.getContractFactory("FixedInterest");
  const fixedInterest = await fixedModel.deploy();

  /* Deploy Receipt */
  const receipt = await ethers.deployContract("LenderReceipt");
  
  const kettle = await ethers.deployContract(
    "Kettle", 
    [receipt], { libraries: { FixedInterest: fixedInterest.target, Distributions: distributions.target } });
  await kettle.waitForDeployment();

  /* Set kettle as a supplier of receipts */
  await receipt.setSupplier(kettle, 1);

  console.log({
    distributions: await distributions.getAddress(),
    fixedInterest: await fixedInterest.getAddress(),
    receipt: await receipt.getAddress(),
    kettle: await kettle.getAddress(),
  });
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
