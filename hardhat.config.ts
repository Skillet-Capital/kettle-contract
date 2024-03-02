import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import 'hardhat-ignore-warnings';
import "hardhat-gas-reporter";
import "hardhat-tracer";

import "@openzeppelin/hardhat-upgrades";

import * as dotenv from "dotenv";
dotenv.config();

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.20",
        settings: {
          viaIR: true,
          optimizer: {
            enabled: true,
            runs: 200,
            details: {
              yulDetails: {
                optimizerSteps: "u",
              },
            },
          },
        },
      },
    ]
  },
  warnings: 'off',
  networks: {
    hardhat: {
      forking: {
        url: `https://eth-mainnet.g.alchemy.com/v2/${process.env.MAINNET_ALCHEMY_KEY}`,
        blockNumber: 19120000
      },
      allowUnlimitedContractSize: true,
      chainId: 1,
      gas: 1e9,
      blockGasLimit: 0x1fffffffffffff,
    },
  },
  gasReporter: {
    enabled: true
  }
};

export default config;
