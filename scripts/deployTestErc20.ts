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

  // mint tokens to owners
  const SEAN = "0xe511e84f35Ec0782ae5ff1759E81512DcFdc67f1";
  const BILLY = "0xc12FCAB8f1ED029AD841E5c3Ef837D1C3C40d02d";
  const JORDAN = "0x7c8d5Bb6993f0fF96d088A4890F6ab26553743C1";
  const ANDREW = "0x6a37E847e2CD1ce50fC9F6bbD1C89c35266bB74F";
  const NATHAN = "0x2eefe055e429E51Fd5658b05F4Bd88b53434958B";

  await testErc20.mint(SEAN, ethers.parseEther("10000000"));
  await testErc20.mint(BILLY, ethers.parseEther("10000000"));
  await testErc20.mint(JORDAN, ethers.parseEther("10000000"));
  await testErc20.mint(ANDREW, ethers.parseEther("10000000"));
  await testErc20.mint(NATHAN, ethers.parseEther("10000000"));
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
