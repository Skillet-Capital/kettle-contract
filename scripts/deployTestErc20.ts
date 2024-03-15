import { ethers, run } from "hardhat";

async function main() {
  const [owner] = await ethers.getSigners();
  console.log(await owner.provider.getBalance(owner));

  /* Deploy Helpers */
  const TestERC20 = await ethers.getContractFactory("TestERC20");
  const testErc20 = await TestERC20.deploy(18);

  console.log({
    testErc20: await testErc20.getAddress(),
  });

  await new Promise(res => setTimeout(res, 1000 * 20));

  await run("verify:verify", {
    address: testErc20.target,
    constructorArguments: [18],
  });
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
