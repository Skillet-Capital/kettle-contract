// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

enum LienStatus {
    CURRENT,
    DELINQUENT,
    DEFAULTED
}

struct LienState {
    uint256 paidThrough;
    uint256 principal;
}

struct Lien {
    address lender;
    address recipient;
    address borrower;
    address currency;
    address collection;
    uint256 tokenId;
    uint256 size;
    uint256 principal;
    uint256 rate;
    uint256 fee;
    uint256 period;
    uint256 gracePeriod;
    uint256 tenor;
    uint256 startTime;
    LienState state;
}

enum Criteria { SIMPLE, PROOF }

struct Collateral {
    address collection;
    Criteria criteria;
    uint256 identifier;
    uint256 size;
}

struct LoanOfferTerms {
    address currency;
    uint256 totalAmount;
    uint256 maxAmount;
    uint256 minAmount;
    uint256 rate;
    uint256 fee;
    uint256 period;
    uint256 gracePeriod;
    uint256 tenor;
}

struct LoanOffer {
    address lender;
    address recipient;
    Collateral collateral;
    LoanOfferTerms terms;
    uint256 expiration;
    uint256 salt;
}

struct BorrowOfferTerms {
    address currency;
    uint256 amount;
    uint256 rate;
    uint256 fee;
    uint256 period;
    uint256 gracePeriod;
    uint256 tenor;
}

struct BorrowOffer {
    address borrower;
    address recipient;
    Collateral collateral;
    BorrowOfferTerms terms;
    uint256 expiration;
    uint256 salt;
}

enum Side { BID, ASK }

struct MarketOfferTerms {
    address currency;
    uint256 amount;
    bool withLoan;
    uint256 borrowAmount;
    bytes32 loanOfferHash;
}

struct MarketOffer {
    Side side;
    address maker;
    Collateral collateral;
    MarketOfferTerms terms;
    uint256 expiration;
    uint256 salt;
}
