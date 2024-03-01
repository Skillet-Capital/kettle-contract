import { ethers } from "hardhat";
import { Addressable, Signer } from "ethers";
import { Kettle, LienStruct, LoanOfferStruct, LoanOfferTermsStruct, CollateralStruct, MarketOfferStruct, MarketOfferTermsStruct } from "../../typechain-types/contracts/Kettle";


const collateralTypes = [
  { name: "collection", type: "address" },
  { name: "criteria", type: "uint8" },
  { name: "identifier", type: "uint256" },
  { name: "size", type: "uint256" }
];

const loanOfferTermsTypes = [
  { name: "currency", type: "address" },
  { name: "totalAmount", type: "uint256" },
  { name: "maxAmount", type: "uint256" },
  { name: "minAmount", type: "uint256" },
  { name: "rate", type: "uint256" },
  { name: "fee", type: "uint256" },
  { name: "period", type: "uint256" },
  { name: "gracePeriod", type: "uint256" },
  { name: "tenor", type: "uint256" }
];

const marketOfferTermsTypes = [
  { name: "currency", type: "address" },
  { name: "amount", type: "uint256" },
  { name: "withLoan", type: "bool" },
  { name: "borrowAmount", type: "uint256" },
];

export async function signMarketOffer(
  kettle: Kettle,
  maker: Signer,
  marketOffer: MarketOfferStruct 
) {

  const domain = {
    name: 'Kettle',
    version: '3',
    chainId: 1,
    verifyingContract: await kettle.getAddress()
  }

  const types = {
    MarketOffer: [
      { name: 'side', type: 'uint8' },
      { name: 'maker', type: 'address' },
      { name: 'collateral', type: 'Collateral' },
      { name: 'terms', type: 'MarketOfferTerms' },
      { name: 'expiration', type: 'uint256' },
      { name: 'salt', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
    ],
    Collateral: collateralTypes,
    MarketOfferTerms: marketOfferTermsTypes
  }

  return await maker.signTypedData(domain, types, { 
    ...marketOffer,
    maker: await maker.getAddress(),
    terms: {
      ...marketOffer.terms,
      currency: await (marketOffer.terms.currency as Addressable).getAddress(),
    },
    collateral: {
      ...marketOffer.collateral,
      collection: await (marketOffer.collateral.collection as Addressable).getAddress()
    },
    nonce: await kettle.nonces(maker),
  });
}

export async function signLoanOffer(
  kettle: Kettle,
  lender: Signer,
  loanOffer: LoanOfferStruct 
) {

  const domain = {
    name: 'Kettle',
    version: '3',
    chainId: 1,
    verifyingContract: await kettle.getAddress()
  }

  const types = {
    LoanOffer: [
      { name: 'lender', type: 'address' },
      { name: 'recipient', type: 'address' },
      { name: 'collateral', type: 'Collateral' },
      { name: 'terms', type: 'LoanOfferTerms' },
      { name: 'expiration', type: 'uint256' },
      { name: 'salt', type: 'uint256' },
      { name: 'nonce', type: 'uint256' }
    ],
    Collateral: collateralTypes,
    LoanOfferTerms: loanOfferTermsTypes
  }

  return await lender.signTypedData(domain, types, { 
    ...loanOffer,
    lender: await lender.getAddress(),
    recipient: await (loanOffer.recipient as Addressable).getAddress(),
    terms: {
      ...loanOffer.terms,
      currency: await (loanOffer.terms.currency as Addressable).getAddress(),
    },
    collateral: {
      ...loanOffer.collateral,
      collection: await (loanOffer.collateral.collection as Addressable).getAddress()
    },
    nonce: await kettle.nonces(lender),
  });
}
