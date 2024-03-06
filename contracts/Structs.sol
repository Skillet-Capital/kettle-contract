// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

enum LienStatus {
    CURRENT,
    DELINQUENT,
    DEFAULTED
}

struct LienState {
    uint256 installment;
    uint256 principal;
}

struct PaymentDeadline {
    uint256 periodStart;
    uint256 deadline;
    uint256 principal;
    uint256 interest;
    uint256 fee;
}

enum ItemType { ERC721, ERC1155 }

struct Lien {
    address recipient;
    address borrower;
    address currency;
    address collection;
    ItemType itemType;
    uint256 tokenId;
    uint256 size;
    uint256 principal;
    uint256 rate;
    uint256 defaultRate;
    uint256 fee;
    uint256 period;
    uint256 gracePeriod;
    uint256 installments;
    uint256 startTime;
    LienState state;
}

enum Criteria { SIMPLE, PROOF }

struct Collateral {
    address collection;
    Criteria criteria;
    ItemType itemType;
    uint256 identifier;
    uint256 size;
}

struct FeeTerms {
    address recipient;
    uint256 rate;
}

struct LoanOfferTerms {
    address currency;
    uint256 totalAmount;
    uint256 maxAmount;
    uint256 minAmount;
    uint256 rate;
    uint256 defaultRate;
    uint256 period;
    uint256 gracePeriod;
    uint256 installments;
}

struct LoanOffer {
    address lender;
    Collateral collateral;
    LoanOfferTerms terms;
    FeeTerms fee;
    uint256 expiration;
    uint256 salt;
}

struct BorrowOfferTerms {
    address currency;
    uint256 amount;
    uint256 rate;
    uint256 defaultRate;
    uint256 period;
    uint256 gracePeriod;
    uint256 installments;
}

struct BorrowOffer {
    address borrower;
    Collateral collateral;
    BorrowOfferTerms terms;
    FeeTerms fee;
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
    FeeTerms fee;
    uint256 expiration;
    uint256 salt;
}
