import { ethers, run } from "hardhat";

async function main() {
  const [owner] = await ethers.getSigners();
  console.log(await owner.provider.getBalance(owner));

  /* Deploy Helpers */
  const Distributions = await ethers.getContractFactory("Distributions");
  const distributions = await Distributions.deploy();

  /* Deploy Models */
  const CompoundInterest = await ethers.getContractFactory("CompoundInterest");
  const compoundInterest = await CompoundInterest.deploy();

  /* Deploy Receipt */
  const receipt = await ethers.deployContract("LenderReceipt");
  
  const kettle = await ethers.deployContract(
    "Kettle", 
    [receipt], { libraries: { CompoundInterest: compoundInterest.target, Distributions: distributions.target } });
  await kettle.waitForDeployment();

  /* Set kettle as a supplier of receipts */
  await receipt.setSupplier(kettle, 1);

  console.log({
    distributions: await distributions.getAddress(),
    compoundInterest: await compoundInterest.getAddress(),
    receipt: await receipt.getAddress(),
    kettle: await kettle.getAddress(),
  });

  await new Promise(res => setTimeout(res, 1000 * 20));

  await run("verify:verify", {
    address: receipt.target,
    constructorArguments: []
  });

  await run("verify:verify", {
    address: kettle.target,
    constructorArguments: [receipt.target],
  });
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
