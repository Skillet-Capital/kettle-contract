import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import 'hardhat-ignore-warnings';
import "hardhat-gas-reporter";
import "hardhat-tracer";

const config: HardhatUserConfig = {
  solidity: "0.8.20",
  warnings: 'off',
  networks: {
    hardhat: {
      allowUnlimitedContractSize: true,
      chainId: 1,
      gas: 2100000,
      blockGasLimit: 0x1fffffffffffff,
    },
  },
  gasReporter: {
    enabled: true
  }
};

export default config;
