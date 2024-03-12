import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import 'hardhat-ignore-warnings';
import "hardhat-gas-reporter";
import "hardhat-tracer";
import "hardhat-contract-sizer";
import "@nomicfoundation/hardhat-verify";

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
    blast_sepolia: {
      url: `https://sepolia.blast.io`,
      accounts: [
        process.env.PK!,
      ]
    },
    blast: {
      url: 'https://lingering-indulgent-replica.blast-mainnet.quiknode.pro/6667a8f4be701cb6549b415d567bc706fb2f13a8/',
      accounts: [
        process.env.PK!
      ]
    },
  },
  etherscan: {
    apiKey: {
      blast_sepolia: "blast_sepolia",
      blast: "PTQ5343WRG7127WRWQUQMBABZHDSZUTPFW"
    },
    customChains: [
      {
        network: "blast_sepolia",
        chainId: 168587773,
        urls: {
          apiURL: "https://api.routescan.io/v2/network/testnet/evm/168587773/etherscan",
          browserURL: "https://testnet.blastscan.io"
        }
      },
      {
        network: "blast",
        chainId: 81457,
        urls: {
          apiURL: "https://api.blastscan.io/api",
          browserURL: "https://blastscan.io"
        }
      }
    ]
  },
  gasReporter: {
    enabled: true
  }
};

export default config;
